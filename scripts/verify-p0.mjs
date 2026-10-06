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
// enqueue_whatsapp_messages contains a regroup failure rather than lose a message; here any such warning is a bug.
const warnings = [];
for (const client of [db, other]) client.on("notice", (n) => { if (n.severity === "WARNING") warnings.push(n.message); });
async function rpc(fn, args) {
  return (await db.query(`select ${fn}(${args.map((_,i)=>`$${i+1}`).join(",")}) as result`, args)).rows[0].result;
}
let clock = Date.parse("2026-10-04T00:00:00Z");
// Each message is sent a second after the last unless a send time is given: batch membership follows message_timestamp.
const m = (id, mode, caption="", sender="test-admin", at=(clock+=1000), extra={}) => ({ message_id:id,sender_phone:sender,mode,caption,message_timestamp:new Date(at).toISOString(),media_id:`media-${id}`,public_id:`asset-${id}`,raw_message:{id},...extra });
/** WhatsApp time passes without anything being sent. */
const pause = (seconds) => { clock += seconds*1000; };
const sweep = (sender=null) => rpc("whatsapp_sweep", [sender]);
const batchOf = async (id) => (await db.query("select b.* from whatsapp_batches b join whatsapp_inbox i on i.batch_id=b.id where i.message_id=$1",[id])).rows[0];
/** Upload every claimable photo/video for a sender. */
const upload = async (sender) => { for (;;) { const job=await claimNext(sender); if (job.idle || job.mode!=="media") return job; await checkpoint(job.message_id,job); await complete(job.message_id,job); } };
/** Let time pass for a sender's open messages and notices without sleeping. */
const age = async (sender, interval) => {
  await db.query("update whatsapp_inbox set created_at=created_at-$2::interval where sender_phone=$1",[sender,interval]);
  await db.query("update whatsapp_batches set asked_at=asked_at-$2::interval where sender_phone=$1",[sender,interval]);
  await db.query("update whatsapp_notices set not_before=not_before-$2::interval where sender_phone=$1",[sender,interval]);
};
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
  await enqueue([m("late-failure","finalize","Late","late-admin",undefined,{kind:"image"})]);
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
  // Description first (029): parked instead of answered "No photos"; its photos are still never queued behind each other.
  await enqueue([m("p-text-1","finalize","Silk","prod-admin")]);
  assert.deepEqual(await claimNext("prod-admin"),{idle:true,in_flight:false});
  assert.equal((await batchOf("p-text-1")).status,"awaiting_media");
  assert.equal(await rpc("whatsapp_settled",[["p-text-1"]]),true); // parked: nothing for Meta to redeliver
  await enqueue([m("p1","media","","prod-admin"),m("p2","media","","prod-admin")]);
  // Media needs nothing but itself: p2 is claimable while p1 is still in flight.
  const p2=await claim("p2"); const p1=await claim("p1"); assert.ok(p1.token&&p2.token);
  assert.deepEqual(await claimNext("prod-admin"),{idle:true,in_flight:true});
  for (const [id,job] of [["p1",p1],["p2",p2]]) { await checkpoint(id,job); await complete(id,job); }
  // Uploaded but still inside the quiet period: the description keeps waiting.
  assert.deepEqual(await sweep("prod-admin"),["prod-admin"]);
  assert.deepEqual(await claimNext("prod-admin"),{idle:true,in_flight:false});
  const wake=await rpc("whatsapp_next_wake",["prod-admin"]); assert.ok(wake>40&&wake<=45,`quiet period due in ${wake}s`);
  await age("prod-admin","46 seconds"); await sweep("prod-admin");
  const pText1=await claimNext("prod-admin"); assert.equal(pText1.message_id,"p-text-1");
  assert.deepEqual(pText1.pending_media.map(x=>x.message_id),["p1","p2"]);
  assert.equal(pText1.grouping,"2 sent after your description");
  await complete("p-text-1",pText1,plan("prod-listing",pText1.pending_media,{reply:"First"}));
  pause(60);
  await enqueue([m("p3","media","","prod-admin"),m("p-text-2","finalize","Cotton","prod-admin")]);
  const pText2=await upload("prod-admin"); assert.equal(pText2.message_id,"p-text-2");
  assert.deepEqual(pText2.pending_media.map(x=>x.message_id),["p3"]); assert.equal(pText2.grouping,"1 sent before your description");
  await complete("p-text-2",pText2,plan("prod-listing-2",pText2.pending_media,{reply:"Second"}));
  const prodRows=Object.fromEntries((await db.query("select message_id,batch_id from whatsapp_inbox where sender_phone='prod-admin'")).rows.map(r=>[r.message_id,r.batch_id]));
  assert.equal(prodRows["p1"],prodRows["p-text-1"]); assert.equal(prodRows["p1"],prodRows["p2"]); assert.equal(prodRows["p3"],prodRows["p-text-2"]);
  assert.notEqual(prodRows["p1"],prodRows["p3"]);
  assert.deepEqual(await claimNext("prod-admin"),{idle:true,in_flight:false});
  console.log("PASS 029: description first is parked, takes the photos sent after it and closes on the quiet period; media is never queued behind media");
  // Replies are leased: one claimer gets them, a second gets nothing until the lease lapses.
  const due=await rpc("claim_whatsapp_replies",["prod-admin"]);
  assert.deepEqual(due.map(r=>[r.message_id,r.reply,r.state]),[["p-text-1","First","done"],["p-text-2","Second","done"]]);
  assert.deepEqual(await rpc("claim_whatsapp_replies",["prod-admin"]),[]);
  await rpc("finish_whatsapp_reply",["p-text-1",true]); await rpc("finish_whatsapp_reply",["p-text-2",false]);
  assert.deepEqual(await rpc("claim_whatsapp_replies",["prod-admin"]),[]); // a failed send backs off
  await db.query("update whatsapp_inbox set reply_lease_until=now()-interval '1 second' where message_id='p-text-2'");
  assert.deepEqual((await rpc("claim_whatsapp_replies",["prod-admin"])).map(r=>r.message_id),["p-text-2"]);
  await db.query("update whatsapp_inbox set reply_attempts=5,reply_lease_until=null where message_id='p-text-2'");
  assert.deepEqual(await rpc("claim_whatsapp_replies",["prod-admin"]),[]); // bounded
  console.log("PASS 028: replies are leased, retried with backoff and bounded");
  // A description that timed out with nothing is never a join target, even for media stamped in its own second.
  const sameSecond=(clock+=1000);
  await enqueue([m("s-text","finalize","Silk","same-admin",sameSecond)]);
  await age("same-admin","11 minutes"); await sweep("same-admin");
  assert.equal((await batchOf("s-text")).status,"closed_empty");
  assert.match((await row("s-text")).reply,/within 10 minutes, so no listing was created/);
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
  // ---- Migration 029: grouping by description ----
  const reasons = async (sender) => Object.fromEntries((await db.query("select i.message_id,i.assignment_reason,i.confidence,b.description_id from whatsapp_inbox i join whatsapp_batches b on b.id=i.batch_id where i.sender_phone=$1 and i.mode='media'",[sender])).rows.map(r=>[r.message_id,[r.description_id,r.assignment_reason,r.confidence]]));
  // The production incident, with the pause that was there: D1, album A, 13s, album B, D2.
  await enqueue([m("i-d1","finalize","Bandhej","inc-admin"),m("i-a1","media","","inc-admin"),m("i-a2","media","","inc-admin")]);
  pause(13);
  await enqueue([m("i-b1","media","","inc-admin"),m("i-b2","media","","inc-admin")]);
  pause(6);
  await enqueue([m("i-d2","finalize","Bandhej","inc-admin")]);
  assert.deepEqual(await reasons("inc-admin"),{"i-a1":["i-d1","after_description","high"],"i-a2":["i-d1","after_description","high"],
    "i-b1":["i-d2","before_description","high"],"i-b2":["i-d2","before_description","high"]});
  const iD1=await upload("inc-admin"); assert.equal(iD1.message_id,"i-d1"); assert.deepEqual(iD1.pending_media.map(x=>x.message_id),["i-a1","i-a2"]);
  await complete("i-d1",iD1,plan("incident-a",iD1.pending_media));
  const iD2=await upload("inc-admin"); assert.equal(iD2.message_id,"i-d2"); assert.deepEqual(iD2.pending_media.map(x=>x.message_id),["i-b1","i-b2"]);
  // A plan can still never reach across into the other listing's media.
  await assert.rejects(complete("i-d2",iD2,plan("incident-b",[...iD2.pending_media,asset("i-a1")])),/does not belong to this batch/);
  const iD2b=await (async()=>{ await fail("i-d2",iD2); await elapse("i-d2"); return claimNext("inc-admin"); })();
  await complete("i-d2",iD2b,plan("incident-b",iD2b.pending_media));
  assert.deepEqual((await db.query("select slug,count(*)::int as media from whatsapp_listing_audit where slug like 'incident-%' and mode='media' group by slug order by slug")).rows,
    [{slug:"incident-a",media:2},{slug:"incident-b",media:2}]);
  console.log("PASS 029: D1, album, pause, album, D2 gives each description its own album, auditable per message");
  // The same with no pause: one burst between two descriptions is never guessed. Delivered as two racing transactions.
  const q=[m("q-d1","finalize","First","ask-admin"),m("q-m1","media","","ask-admin"),m("q-m2","media","","ask-admin"),m("q-m3","media","","ask-admin"),m("q-d2","finalize","Second","ask-admin")];
  await Promise.all([enqueue([q[0],q[2],q[4]]),other.query("select enqueue_whatsapp_messages($1)",[JSON.stringify([q[1],q[3]])])]);
  await enqueue(q); // every webhook redelivered: nothing changes
  assert.deepEqual([(await batchOf("q-d1")).status,(await batchOf("q-d2")).status],["awaiting_confirmation","awaiting_confirmation"]);
  assert.deepEqual(Object.values(await reasons("ask-admin")).map(r=>r.slice(1)),[["ambiguous","none"],["ambiguous","none"],["ambiguous","none"]]);
  assert.equal((await upload("ask-admin")).idle,true); // photos upload; neither description can run
  assert.deepEqual(await rpc("claim_whatsapp_replies",["ask-admin"]),[]); // held a moment, so it counts the whole album
  await age("ask-admin","5 seconds");
  const asked=await rpc("claim_whatsapp_replies",["ask-admin"]);
  assert.deepEqual(asked.map(r=>r.state),["notice"]); assert.match(asked[0].reply,/then 3 photo\(s\)\/video\(s\), then description 2 \("Second"\)/);
  await rpc("finish_whatsapp_reply",[asked[0].message_id,true]);
  assert.deepEqual(await rpc("claim_whatsapp_replies",["ask-admin"]),[]);
  assert.equal((await db.query("select count(*)::int as n from whatsapp_notices where sender_phone='ask-admin'")).rows[0].n,1);
  await age("ask-admin","46 seconds"); await sweep("ask-admin"); // a quiet period does not answer a question
  assert.equal((await claimNext("ask-admin")).idle,true);
  await enqueue([m("q-answer","finalize","2","ask-admin")]);
  assert.equal((await row("q-answer")).mode,"answer");
  assert.deepEqual(await reasons("ask-admin"),{"q-m1":["q-d2","confirmed_second","confirmed"],"q-m2":["q-d2","confirmed_second","confirmed"],"q-m3":["q-d2","confirmed_second","confirmed"]});
  assert.match((await row("q-d1")).reply,/No listing was created for "First"/);
  const qD2=await claimNext("ask-admin"); assert.equal(qD2.message_id,"q-d2"); assert.equal(qD2.grouping,"3 you confirmed");
  await complete("q-d2",qD2,plan("asked-listing",qD2.pending_media));
  await enqueue([m("q-stray","finalize","3","ask-admin")]);
  assert.match((await row("q-stray")).reply,/no question waiting/);
  console.log("PASS 029: one burst between two descriptions is held and asked about once; the answer decides; racing deliveries converge");
  // No answer in 10 minutes: the contested media becomes its own draft, mixed into nothing.
  await enqueue([m("t-d1","finalize","First","aside-admin"),m("t-v","media","","aside-admin",undefined,{kind:"video"}),m("t-m","media","","aside-admin"),m("t-d2","finalize","Second","aside-admin")]);
  for (const id of ["t-v","t-m"]) { const job=await claim(id); await rpc("checkpoint_whatsapp_asset",[id,job.token,JSON.stringify({...asset(id),kind:id==="t-v"?"video":"image"})]); await complete(id,job); }
  await age("aside-admin","11 minutes"); await sweep("aside-admin");
  const aside=(await db.query("select p.name,p.status,p.slug,array_agg(i.image_url order by i.display_order) as urls,array_agg(i.is_primary order by i.display_order) as prim,array_agg(i.media_type order by i.display_order) as kinds from products p join product_variants v on v.product_id=p.id join variant_images i on i.variant_id=v.id where p.id=(select product_id from whatsapp_batches where sender_phone='aside-admin' and status='unassigned') group by p.id")).rows[0];
  assert.equal(aside.name,"Unassigned WhatsApp media"); assert.equal(aside.status,"draft"); assert.match(aside.slug,/^unassigned-whatsapp-media-/);
  assert.deepEqual([aside.urls,aside.prim,aside.kinds],[[asset("t-v").url,asset("t-m").url],[false,true],["video","image"]]); // the primary is the photo, not the video
  assert.deepEqual([(await row("t-d1")).state,(await row("t-d2")).state],["done","done"]);
  assert.equal((await db.query("select count(*)::int as n from products where slug in ('t-d1','t-d2')")).rows[0].n,0);
  assert.ok((await rpc("claim_whatsapp_replies",["aside-admin"])).some(r=>/saved as the draft "Unassigned WhatsApp media"/.test(r.reply)));
  // Photos that never get a description are set aside after 30 minutes instead of joining the next listing.
  await enqueue([m("o1","media","","orphan-admin"),m("o2","media","","orphan-admin")]); await upload("orphan-admin");
  await age("orphan-admin","31 minutes"); pause(31*60);
  await enqueue([m("o3","media","","orphan-admin"),m("o-text","finalize","Silk","orphan-admin")]);
  assert.deepEqual(await reasons("orphan-admin"),{o1:[null,"unassigned","none"],o2:[null,"unassigned","none"],o3:["o-text","before_description","high"]});
  assert.equal((await db.query("select count(*)::int as n from whatsapp_batches where sender_phone='orphan-admin' and status='unassigned' and product_id is not null")).rows[0].n,1);
  console.log("PASS 029: unanswered questions and stale photos become an 'Unassigned WhatsApp media' draft; nothing is mixed or lost");
  // Explicit signals win: a reply to a photo owns that photo's album; a caption owns the album around it.
  await enqueue([m("x-a1","media","","explicit-admin"),m("x-a2","media","","explicit-admin")]);
  pause(20);
  await enqueue([m("x-b1","media","","explicit-admin")]);
  pause(3);
  await enqueue([m("x-reply","finalize","Silk","explicit-admin",undefined,{raw_message:{id:"x-reply",context:{id:"x-a2"}}})]);
  assert.deepEqual(await reasons("explicit-admin"),{"x-a1":["x-reply","reply_to_media","explicit"],"x-a2":["x-reply","reply_to_media","explicit"],"x-b1":[null,"awaiting_description","provisional"]});
  pause(60);
  await enqueue([m("x-c1","media","","explicit-admin"),m("x-cap","finalize","Cotton","explicit-admin",undefined,{kind:"image"})]);
  await enqueue([m("x-c2","media","","explicit-admin")]); // the rest of the captioned album, a moment later
  const explicit=await reasons("explicit-admin");
  assert.deepEqual([explicit["x-c1"],explicit["x-c2"]],[["x-cap","caption_album","explicit"],["x-cap","straggler","high"]]);
  assert.deepEqual(explicit["x-b1"],[null,"awaiting_description","provisional"]); // never swept into a listing it was not sent with
  console.log("PASS 029: reply-to-photo and captions assign explicitly");
  // A batch grouped before 029 keeps working: the migration is replayable and leaves it closed with 028's straggler window.
  const legacyAt=new Date(clock+=1000).toISOString();
  await db.query(`with b as (insert into whatsapp_batches(sender_phone,sealed) values('legacy-admin',true) returning id)
    insert into whatsapp_inbox(message_id,sender_phone,batch_id,payload,mode) select x.id,'legacy-admin',b.id,jsonb_build_object('message_id',x.id,'sender_phone','legacy-admin','mode',x.mode,'caption','Old','message_timestamp',$1::text),x.mode
      from b,(values('l-photo','media'),('l-text','finalize')) x(id,mode)`,[legacyAt]);
  const before029=(await db.query("select id,status,frozen_at,claim_to,summary from whatsapp_batches where status is not null order by sequence")).rows;
  await db.query(readFileSync("supabase/migrations/029_whatsapp_grouping.sql","utf8"));
  assert.deepEqual((await db.query("select id,status,frozen_at,claim_to,summary from whatsapp_batches where status is not null and sender_phone<>'legacy-admin' order by sequence")).rows,before029);
  const legacy=await batchOf("l-text"); assert.equal(legacy.status,"legacy"); assert.ok(legacy.frozen_at); assert.equal(legacy.claim_to.toISOString(),legacyAt);
  const lText=await upload("legacy-admin"); assert.equal(lText.message_id,"l-text"); assert.deepEqual(lText.pending_media.map(x=>x.message_id),["l-photo"]);
  await complete("l-text",lText,plan("legacy-listing",lText.pending_media));
  await enqueue([m("l-late","media","","legacy-admin",Date.parse(legacyAt)-5000)]);
  assert.equal((await row("l-late")).batch_id,legacy.id);
  console.log("PASS 029: replaying the migration changes nothing; pre-029 batches stay closed and keep their straggler window");
  assert.deepEqual(warnings,[]);
  // Function/table/sequence grants work with the real service_role, not only the owner.
  await db.query("set role service_role");
  await enqueue([m("service","media","","service-admin"),m("service-text","finalize","Silk","service-admin")]);
  const service=await claim("service"); await checkpoint("service",service); await complete("service",service);
  await sweep(); await rpc("whatsapp_next_wake",["service-admin"]); await rpc("claim_whatsapp_replies",["service-admin"]);
  assert.equal((await db.query("select count(*)::int as n from whatsapp_listing_audit where sender_phone='service-admin'")).rows[0].n,2);
  await db.query("reset role");
  console.log("PASS: crashed workers reclaimable with fenced checkpoints");
  for (const role of ["anon","authenticated"]) {
    await db.query(`set role ${role}`);
    await assert.rejects(db.query("select * from whatsapp_inbox"),/permission denied/);
    await assert.rejects(db.query("select claim_whatsapp_message('a')"),/permission denied/);
    await assert.rejects(db.query("select save_storefront_page_draft('home','{}')"),/permission denied/);
    await assert.rejects(db.query("select * from whatsapp_notices"),/permission denied/);
    await assert.rejects(db.query("select * from whatsapp_listing_audit"),/permission denied/);
    await assert.rejects(db.query("select whatsapp_sweep(null)"),/permission denied/);
    await assert.rejects(db.query("select whatsapp_regroup('x')"),/permission denied/);
    await db.query("reset role");
  }
  console.log("PASS: private inbox and new RPC permissions");
} finally {
  await db.end(); await other.end();
  await root.query(`drop database ${name}`); await root.end();
}
