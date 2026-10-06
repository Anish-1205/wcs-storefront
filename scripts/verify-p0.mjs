/** Disposable local PostgreSQL regression checks. Never reads DATABASE_URL. */
import { Client } from "pg";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { applyMigrations } from "../src/lib/db-migrations.mjs";
const config = { host: "127.0.0.1", port: 55432, user: "audit", database: "postgres" };
const root = new Client(config);
await root.connect();
const name = `wcs_p0_${process.pid}_${Date.now()}`;
await root.query(`create database ${name}`);
const db = new Client({ ...config, database: name });
const other = new Client({ ...config, database: name });
await db.connect(); await other.connect();
async function rpc(fn, args) {
  return (await db.query(`select ${fn}(${args.map((_,i)=>`$${i+1}`).join(",")}) as result`, args)).rows[0].result;
}
let clock = Date.parse("2026-10-04T00:00:00Z");
// Each message is sent a second after the last unless a send time is given: batch membership follows message_timestamp.
const m = (id, mode, caption="", sender="test-admin", at=(clock+=1000)) => ({ message_id:id,sender_phone:sender,mode,caption,message_timestamp:new Date(at).toISOString(),media_id:`media-${id}`,public_id:`asset-${id}`,raw_message:{id} });
const enqueue = (messages) => rpc("enqueue_whatsapp_messages", [JSON.stringify(messages)]);
const claim = (id) => rpc("claim_whatsapp_message", [id]);
const claimNext = (sender) => rpc("claim_next_whatsapp_message", [sender]);
const fail = (id, job, error="injected failure") => rpc("fail_whatsapp_message", [id,job.token,error]);
// Let a retry backoff or worker lease lapse without sleeping.
const elapse = (id) => db.query("update whatsapp_inbox set lease_until=now()-interval '1 second' where message_id=$1",[id]);
const row = async (id) => (await db.query("select * from whatsapp_inbox where message_id=$1",[id])).rows[0];
const asset = (id) => ({ message_id:id,media_id:`media-${id}`,url:`https://example.invalid/${id}.jpg`,kind:"image",public_id:`asset-${id}` });
const checkpoint = (id, job) => rpc("checkpoint_whatsapp_asset", [id,job.token,JSON.stringify(asset(id))]);
const complete = (id, job, plan={}) => rpc("complete_whatsapp_message", [id,job.token,JSON.stringify(plan)]);
const plan = (id, media, extra={}) => ({name:id,slug:id,code:id,description:"Test",price:1000,highlights:[],collection_ids:[],variants:[{color:"Default",media:media.map((x,i)=>({...x,is_primary:i===0,display_order:i+1}))}],reply:"Created",...extra});
try {
  await db.query(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_user::text$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;`);
  for (const file of readdirSync("supabase/migrations").sort()) await db.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  console.log("PASS: all migrations on disposable PostgreSQL");
  await db.query("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text)");
  for (const file of readdirSync("supabase/migrations")) await db.query("insert into supabase_migrations.schema_migrations(version) values($1)",[file.split("_")[0]]);
  const policiesBefore = (await db.query("select * from pg_policies order by tablename,policyname")).rows;
  assert.deepEqual((await applyMigrations(db,"supabase/migrations")).applied,[]);
  assert.deepEqual((await db.query("select * from pg_policies order by tablename,policyname")).rows,policiesBefore);
  await other.query("select pg_advisory_lock(746392018)");
  await assert.rejects(applyMigrations(db,"supabase/migrations"),/running/);
  await other.query("select pg_advisory_unlock(746392018)");
  console.log("PASS F01: numeric ledger replay skipped, policies unchanged, concurrent apply blocked");
  // Live published state captured before the very first draft save: no row at all.
  assert.deepEqual((await db.query("select page,content from storefront_page_content where page='home'")).rows,[]);
  await rpc("save_storefront_page_draft",["home",JSON.stringify({heroTitle:"PRIVATE"})]);
  // The draft is stored, and published content was neither created nor populated.
  assert.deepEqual((await db.query("select content,draft_content from storefront_page_content where page='home'")).rows[0],
    {content:null,draft_content:{heroTitle:"PRIVATE"}});
  // What a public reader sees: no published override exists, so authored defaults stand.
  await db.query("set role anon");
  assert.deepEqual((await db.query("select page,content from storefront_page_content where page='home'")).rows,[{page:"home",content:null}]);
  await db.query("reset role");
  // A second draft on the same draft-only row still publishes nothing.
  await rpc("save_storefront_page_draft",["home",JSON.stringify({heroTitle:"STILL PRIVATE"})]);
  assert.deepEqual((await db.query("select content,draft_content from storefront_page_content where page='home'")).rows[0],
    {content:null,draft_content:{heroTitle:"STILL PRIVATE"}});
  // Only an explicit publish writes live content.
  await db.query(`update storefront_page_content set content='{"heroTitle":"LIVE"}' where page='home'`);
  assert.equal((await db.query("select content->>'heroTitle' as title from storefront_page_content where page='home'")).rows[0].title,"LIVE");
  // And drafting over a published row leaves that live content byte-for-byte intact.
  const liveBefore=(await db.query("select content from storefront_page_content where page='home'")).rows[0].content;
  await rpc("save_storefront_page_draft",["home",JSON.stringify({heroTitle:"SECOND PRIVATE"})]);
  const after=(await db.query("select content,draft_content from storefront_page_content where page='home'")).rows[0];
  assert.deepEqual(after.content,liveBefore);
  assert.deepEqual(after.draft_content,{heroTitle:"SECOND PRIVATE"});
  console.log("PASS F14: draft saves never create or modify published content");
  await enqueue([m("a","media"),m("close-a","finalize","Silk"),m("b","media"),m("close-b","finalize","Cotton"),m("number-b","numbered","2")]);
  const rows=(await db.query("select message_id,batch_id from whatsapp_inbox order by sequence")).rows;
  assert.equal(rows[0].batch_id,rows[1].batch_id); assert.notEqual(rows[1].batch_id,rows[2].batch_id); assert.equal(rows[3].batch_id,rows[4].batch_id);
  const [a,a2]=await Promise.all([claim("a"),other.query("select claim_whatsapp_message('a') as result").then(r=>r.rows[0].result)]);
  assert.equal([a,a2].filter(j=>j.busy).length,1); const owner=a.busy?a2:a;
  assert.equal((await claim("close-a")).busy,true);
  await checkpoint("a",owner); await complete("a",owner);
  const closeA=await claim("close-a"); assert.deepEqual(closeA.pending_media.map(x=>x.message_id),["a"]);
  const countBefore=Number((await db.query("select count(*) from products")).rows[0].count);
  await assert.rejects(complete("close-a",closeA,plan("first",[asset("a")],{variants:[{color:null,media:[{...asset("a"),is_primary:true,display_order:1}]}]})),/null value/);
  assert.equal(Number((await db.query("select count(*) from products")).rows[0].count),countBefore);
  assert.equal((await db.query("select asset is not null as saved from whatsapp_inbox where message_id='a'")).rows[0].saved,true);
  await fail("close-a",closeA);
  assert.equal((await claim("close-a")).busy,true); // retry backoff
  await elapse("close-a");
  const retry=await claim("close-a");
  await assert.rejects(complete("close-a",closeA,plan("stale",[asset("a")])),/Stale/);
  await complete("close-a",retry,plan("first",retry.pending_media));
  assert.equal((await claim("close-a")).done,true);
  const b=await claim("b"); await checkpoint("b",b); await complete("b",b);
  const closeB=await claim("close-b"); assert.deepEqual(closeB.pending_media.map(x=>x.message_id),["b"]);
  await complete("close-b",closeB,plan("second",closeB.pending_media));
  const numbered=await claim("number-b"); await checkpoint("number-b",numbered); await complete("number-b",numbered);
  assert.equal(Number((await db.query("select count(*) from products")).rows[0].count),countBefore+2);
  const productMedia=(await db.query("select p.slug,array_agg(i.image_url order by i.display_order) as urls from products p join product_variants v on v.product_id=p.id join variant_images i on i.variant_id=v.id where p.slug in ('first','second') group by p.slug order by p.slug")).rows;
  assert.deepEqual(productMedia,[{slug:"first",urls:[asset("a").url]},{slug:"second",urls:[asset("b").url,asset("number-b").url]}]);
  await enqueue([m("a","media")]); assert.equal((await claim("a")).done,true);
  console.log("PASS F03/F04: atomic claims, batch ordering, stable batches, rollback, checkpoints, stale-worker fencing, numbered ownership, duplicate replay");
  await enqueue([m("expired","media","","other-admin")]); const expired=await claim("expired");
  await db.query("update whatsapp_inbox set lease_until=now()-interval '1 minute' where message_id='expired'");
  const reclaimed=await claim("expired"); assert.notEqual(expired.token,reclaimed.token);
  await assert.rejects(checkpoint("expired",expired),/Stale/);
  await enqueue([m("x","media","","race-admin"),m("close-x","finalize","X","race-admin")]);
  const x=await claim("x"); await checkpoint("x",x); await complete("x",x);
  const closeX=await claim("close-x");
  // Exact old race: a photo arrives after the finalizer's snapshot but before reset.
  await enqueue([m("y","media","","race-admin")]);
  await complete("close-x",closeX,plan("race-first",closeX.pending_media));
  const y=await claim("y"); await checkpoint("y",y); await complete("y",y);
  await enqueue([m("close-y","finalize","Y","race-admin")]);
  const closeY=await claim("close-y"); assert.deepEqual(closeY.pending_media.map(x=>x.message_id),["y"]);
  await complete("close-y",closeY,plan("race-second",closeY.pending_media));
  console.log("PASS F04: arrival between snapshot and completion survives in the next batch");
  // Legacy receipts dedupe without rotating the current batch.
  await db.query("insert into whatsapp_ingest_events(message_id,sender_phone,message_timestamp,image_url,media_id) values('legacy','race-admin',now(),'https://example.invalid/legacy.jpg','legacy')");
  const batchCount=(await db.query("select count(*) from whatsapp_batches")).rows[0].count;
  await enqueue([m("legacy","finalize","old","race-admin")]);
  assert.equal((await claim("legacy")).done,true);
  assert.equal((await db.query("select count(*) from whatsapp_batches")).rows[0].count,batchCount);
  // A failure at the last write must roll back products, variants, images and session.
  await enqueue([m("late-failure","finalize","Late","late-admin")]);
  const late=await claim("late-failure"); await checkpoint("late-failure",late);
  await db.query(`create function fail_last_ingest() returns trigger language plpgsql as $$begin
    if new.message_id='late-failure' then raise exception 'injected late write'; end if; return new; end$$;
    create trigger p0_fail_last before insert on whatsapp_ingest_events for each row execute function fail_last_ingest()`);
  await assert.rejects(complete("late-failure",late,plan("late-product",[asset("late-failure")])),/injected late write/);
  assert.equal((await db.query("select count(*) from products where slug='late-product'")).rows[0].count,"0");
  assert.equal((await db.query("select count(*) from variant_images where image_url=$1",[asset("late-failure").url])).rows[0].count,"0");
  assert.equal((await db.query("select count(*) from admin_upload_sessions where admin_phone='late-admin'")).rows[0].count,"0");
  assert.equal((await db.query("select asset is not null as saved from whatsapp_inbox where message_id='late-failure'")).rows[0].saved,true);
  await db.query("drop trigger p0_fail_last on whatsapp_ingest_events");
  await fail("late-failure",late,"last write failed"); await elapse("late-failure");
  const retryLate=await claim("late-failure"); await complete("late-failure",retryLate,plan("late-product",[retryLate.asset]));
  console.log("PASS F03: failure at final receipt write rolls back every logical effect; checkpoint survives replay");
  // ---- Migration 028: no head-of-line blocking, drain, dead-letter, leased replies ----
  // The production sequence: description first, then photos, then the description again.
  await enqueue([m("p-text-1","finalize","Silk","prod-admin")]);
  const pText1=await claimNext("prod-admin"); assert.equal(pText1.message_id,"p-text-1"); assert.deepEqual(pText1.pending_media,[]);
  await complete("p-text-1",pText1,{variants:[],reply:"No photos"});
  await enqueue([m("p1","media","","prod-admin"),m("p2","media","","prod-admin")]);
  // Media needs nothing but itself: p2 is claimable while p1 is still in flight.
  const p2=await claim("p2"); const p1=await claim("p1"); assert.ok(p1.token&&p2.token);
  await enqueue([m("p-text-2","finalize","Silk","prod-admin")]);
  assert.deepEqual(await claimNext("prod-admin"),{idle:true,in_flight:true});
  for (const [id,job] of [["p1",p1],["p2",p2]]) { await checkpoint(id,job); await complete(id,job); }
  const pText2=await claimNext("prod-admin"); assert.equal(pText2.message_id,"p-text-2");
  assert.deepEqual(pText2.pending_media.map(x=>x.message_id),["p1","p2"]);
  await complete("p-text-2",pText2,plan("prod-listing",pText2.pending_media));
  const prodRows=Object.fromEntries((await db.query("select message_id,batch_id from whatsapp_inbox where sender_phone='prod-admin'")).rows.map(r=>[r.message_id,r.batch_id]));
  assert.notEqual(prodRows["p1"],prodRows["p-text-1"]); assert.equal(prodRows["p1"],prodRows["p2"]); assert.equal(prodRows["p1"],prodRows["p-text-2"]);
  assert.deepEqual(await claimNext("prod-admin"),{idle:true,in_flight:false});
  console.log("PASS 028: text, photos, text builds one listing in a fresh batch; media is never queued behind media");
  // Replies are leased: one claimer gets them, a second gets nothing until the lease lapses.
  const due=await rpc("claim_whatsapp_replies",["prod-admin"]);
  assert.deepEqual(due.map(r=>[r.message_id,r.reply,r.state]),[["p-text-1","No photos","done"],["p-text-2","Created","done"]]);
  assert.deepEqual(await rpc("claim_whatsapp_replies",["prod-admin"]),[]);
  await rpc("finish_whatsapp_reply",["p-text-1",true]); await rpc("finish_whatsapp_reply",["p-text-2",false]);
  assert.deepEqual(await rpc("claim_whatsapp_replies",["prod-admin"]),[]); // a failed send backs off
  await db.query("update whatsapp_inbox set reply_lease_until=now()-interval '1 second' where message_id='p-text-2'");
  assert.deepEqual((await rpc("claim_whatsapp_replies",["prod-admin"])).map(r=>r.message_id),["p-text-2"]);
  await db.query("update whatsapp_inbox set reply_attempts=5,reply_lease_until=null where message_id='p-text-2'");
  assert.deepEqual(await rpc("claim_whatsapp_replies",["prod-admin"]),[]); // bounded
  console.log("PASS 028: replies are leased, retried with backoff and bounded");
  // An empty finalize is never a join target, even for media stamped in the same second.
  const sameSecond=(clock+=1000);
  await enqueue([m("s-text","finalize","Silk","same-admin",sameSecond)]);
  const sText=await claimNext("same-admin"); await complete("s-text",sText,{variants:[],reply:"No photos"});
  await enqueue([m("s-photo","media","","same-admin",sameSecond)]);
  assert.notEqual((await row("s-photo")).batch_id,(await row("s-text")).batch_id);
  // A straggler landing while the finalize is building: requeued with the attempt refunded, then rebuilt with it.
  await enqueue([m("r1","media","","requeue-admin")]); const r1=await claimNext("requeue-admin"); await checkpoint("r1",r1); await complete("r1",r1);
  const stragglerAt=(clock+=1000);
  await enqueue([m("r-text","finalize","Silk","requeue-admin")]); const rText=await claimNext("requeue-admin");
  await enqueue([m("r-late","media","","requeue-admin",stragglerAt)]);
  assert.equal((await row("r-late")).batch_id,(await row("r1")).batch_id);
  assert.deepEqual(await complete("r-text",rText,plan("requeue-listing",rText.pending_media)),{requeued:true});
  assert.deepEqual((({state,attempts})=>({state,attempts}))(await row("r-text")),{state:"pending",attempts:0});
  assert.equal((await claim("r-text")).busy,true);
  const rLate=await claimNext("requeue-admin"); assert.equal(rLate.message_id,"r-late"); await checkpoint("r-late",rLate); await complete("r-late",rLate);
  const rText2=await claimNext("requeue-admin"); assert.deepEqual(rText2.pending_media.map(x=>x.message_id),["r1","r-late"]);
  await complete("r-text",rText2,plan("requeue-listing",rText2.pending_media));
  assert.equal((await db.query("select count(*) from products where slug like 'requeue-listing%'")).rows[0].count,"1");
  // A photo sent before the description that only turns up after the listing exists is appended to it.
  await enqueue([m("r-later","media","","requeue-admin",stragglerAt)]);
  assert.equal((await row("r-later")).batch_id,(await row("r1")).batch_id);
  const rLater=await claimNext("requeue-admin"); await checkpoint("r-later",rLater); await complete("r-later",rLater);
  assert.match((await row("r-later")).reply,/late photo/);
  assert.deepEqual((await db.query("select array_agg(i.image_url order by i.display_order) as urls from products p join product_variants v on v.product_id=p.id join variant_images i on i.variant_id=v.id where p.slug='requeue-listing'")).rows[0].urls,
    [asset("r1").url,asset("r-late").url,asset("r-later").url]);
  // ...but a days-late redelivery never attaches itself to an unrelated listing.
  await enqueue([m("r-stale","media","","requeue-admin",stragglerAt-86400000)]);
  assert.notEqual((await row("r-stale")).batch_id,(await row("r1")).batch_id);
  console.log("PASS 028: empty finalize is not joinable; stragglers requeue the finalize or append to the listing");
  // Bounded retries: the fifth failure buries the message, which then stops blocking its batch.
  await enqueue([m("d-good","media","","dead-admin"),m("d-bad","media","","dead-admin"),m("d-text","finalize","Silk","dead-admin")]);
  const dGood=await claim("d-good"); await checkpoint("d-good",dGood); await complete("d-good",dGood);
  for (let attempt=1; attempt<=5; attempt++) {
    const dBad=await claimNext("dead-admin"); assert.equal(dBad.message_id,"d-bad"); assert.equal(dBad.attempts,attempt);
    await fail("d-bad",dBad,"Meta media lookup failed (500)");
    if (attempt<5) { assert.deepEqual(await claimNext("dead-admin"),{idle:true,in_flight:false}); await elapse("d-bad"); }
  }
  const buried=await row("d-bad");
  assert.equal(buried.state,"dead"); assert.match(buried.reply,/could not be saved/); assert.match(buried.last_error,/Meta media lookup failed/);
  assert.deepEqual(await claim("d-bad"),{done:true,dead:true});
  const dText=await claimNext("dead-admin"); assert.equal(dText.message_id,"d-text");
  assert.deepEqual(dText.pending_media.map(x=>x.message_id),["d-good"]);
  await complete("d-text",dText,plan("dead-listing",dText.pending_media));
  // A worker that is killed every time never calls fail: the expired lease is buried by the next drain.
  await enqueue([m("k1","media","","killed-admin"),m("k-text","finalize","Silk","killed-admin")]);
  const k1=await claimNext("killed-admin");
  await db.query("update whatsapp_inbox set attempts=5,lease_until=now()-interval '1 second' where message_id='k1'");
  const kText=await claimNext("killed-admin"); assert.equal(kText.message_id,"k-text"); assert.deepEqual(kText.pending_media,[]);
  assert.equal((await row("k1")).state,"dead");
  await assert.rejects(checkpoint("k1",k1),/Stale/);
  for (let attempt=1; attempt<=5; attempt++) {
    const job=attempt===1?kText:await claimNext("killed-admin");
    await fail("k-text",job,"boom"); if (attempt<5) await elapse("k-text");
  }
  assert.match((await row("k-text")).reply,/resend the photos\/videos and then the description/);
  assert.deepEqual((await rpc("claim_whatsapp_replies",["killed-admin"])).map(r=>[r.message_id,r.state]),[["k1","dead"],["k-text","dead"]]);
  // A numbered photo with no listing to join is answered, not retried.
  await enqueue([m("n-orphan","numbered","3","killed-admin")]);
  const nOrphan=await claimNext("killed-admin"); await checkpoint("n-orphan",nOrphan); await complete("n-orphan",nOrphan,{reply:"Saved photo 3."});
  assert.match((await row("n-orphan")).reply,/Photo 3 was not added/);
  console.log("PASS 028: retry limit dead-letters with a reply, including killed workers; nothing blocks forever");
  // Function/table/sequence grants work with the real service_role, not only the owner.
  await db.query("set role service_role");
  await enqueue([m("service","media","","service-admin")]);
  const service=await claim("service"); await checkpoint("service",service); await complete("service",service);
  await db.query("reset role");
  console.log("PASS: crashed workers reclaimable with fenced checkpoints");
  for (const role of ["anon","authenticated"]) {
    await db.query(`set role ${role}`);
    await assert.rejects(db.query("select * from whatsapp_inbox"),/permission denied/);
    await assert.rejects(db.query("select claim_whatsapp_message('a')"),/permission denied/);
    await assert.rejects(db.query("select save_storefront_page_draft('home','{}')"),/permission denied/);
    await db.query("reset role");
  }
  console.log("PASS: private inbox and new RPC permissions");
} finally {
  await db.end(); await other.end();
  await root.query(`drop database ${name}`); await root.end();
}
