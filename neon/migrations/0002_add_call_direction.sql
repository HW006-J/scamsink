-- Distinguishes real inbound scam calls from hackathon-demo outbound calls
-- (Twilio -> operator's own phone), both of which flow through the same
-- ConversationRelay pipeline.
alter table calls
  add column if not exists direction text not null default 'inbound'
  check (direction in ('inbound', 'outbound_demo'));
