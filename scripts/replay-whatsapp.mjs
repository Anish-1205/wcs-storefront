/** Operator-triggered replay of persisted messages, never generates new message IDs.
 * node --env-file=.env.local scripts/replay-whatsapp.mjs <message-id>
 * Uses NEXT_PUBLIC_SITE_URL as the explicitly configured webhook destination.
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
const messageId = process.argv[2];
if (!messageId) throw new Error("Provide the inbox message ID to recover.");
for (const key of ["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","WHATSAPP_APP_SECRET","NEXT_PUBLIC_SITE_URL"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const endpoint = new URL("/api/whatsapp", process.env.NEXT_PUBLIC_SITE_URL);
if (endpoint.protocol !== "https:" && !["localhost","127.0.0.1"].includes(endpoint.hostname)) throw new Error("Webhook destination must use HTTPS.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data: target,error} = await db.from("whatsapp_inbox").select("sender_phone,sequence").eq("message_id",messageId).single();
if(error) throw error;
// Replay predecessors first so a later description cannot bypass failed photos.
// Paging by sequence keeps this bounded even for senders with a large history.
let cursor = 0;
while (true) {
  const {data: jobs,error: readError} = await db.from("whatsapp_inbox")
    .select("message_id,payload,sequence,state,reply,reply_sent")
    .eq("sender_phone",target.sender_phone).gt("sequence",cursor).lte("sequence",target.sequence)
    .order("sequence").limit(100);
  if(readError) throw readError;
  if(!jobs.length) break;
  for(const job of jobs) {
    cursor = job.sequence;
    if(job.state === "done" && (!job.reply || job.reply_sent)) continue;
    const message = job.payload.raw_message;
    if(!message?.id) throw new Error(`No raw message available for ${job.message_id}; inspect this legacy record manually.`);
    const body=JSON.stringify({object:"whatsapp_business_account",entry:[{changes:[{value:{messages:[message]}}]}]});
    const response=await fetch(endpoint,{method:"POST",redirect:"error",headers:{"Content-Type":"application/json","x-hub-signature-256":`sha256=${createHmac("sha256",process.env.WHATSAPP_APP_SECRET).update(body).digest("hex")}`},body});
    if(!response.ok) throw new Error(`Replay stopped at ${job.message_id}: HTTP ${response.status}. Inspect last_error; an active lease may need to expire.`);
    console.log(`Recovered ${job.message_id}`);
  }
}
console.log("Replay finished.");
