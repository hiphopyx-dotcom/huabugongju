import "@tanstack/react-start/server-only";
import {randomBytes,randomUUID} from "node:crypto";
import {getSql} from "@/lib/db";
import {digitsPhone,phoneEmails,validPhone} from "@/lib/access/phone";

// The workbench only vouches for the phone. Existing local membership,
// disabled flag, user binding, quotas and owner status remain authoritative.
export async function signInWithStudioIdentity(raw: string) {
  if (!validPhone(raw)) return null;
  const phone=digitsPhone(raw),emails=phoneEmails(phone),sql=await getSql();
  const members=await sql<{user_id:string;name:string;disabled:boolean}>`
    select user_id, name, disabled from studio_members where phone=${phone}
  `;
  const member=members[0];if(!member?.user_id||member.disabled)return null;
  const users=await sql<{id:string;name:string;email:string}>`
    select id, name, email from "user" where id=${member.user_id}
      and (email=${emails[0]} or email=${emails[1]??emails[0]})
  `;
  const user=users[0];if(!user)return null;
  const token=randomBytes(32).toString('base64url');
  const now=new Date().toISOString(),expiry=new Date(Date.now()+86400000).toISOString();
  await sql`insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
    values (${randomUUID()}, ${expiry}::timestamptz, ${token}, ${now}::timestamptz, ${now}::timestamptz, ${user.id})`;
  const cookies=['session_token','session_data','account_data'].map(key=>
    `__Host-grok-auth.${key}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  return {token,cookies,user:{id:user.id,name:user.name||member.name,email:user.email}};
}
