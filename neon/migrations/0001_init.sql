-- ScamSink initial schema: calls, transcript_messages, call_events.
-- Schema is deliberately shaped so multiple historical calls can be listed
-- later, even though the MVP UI only ever shows the latest call.

create extension if not exists pgcrypto;

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  twilio_call_sid text not null unique,
  status text not null default 'ringing' check (status in ('ringing', 'active', 'completed', 'failed')),
  caller_number_masked text,
  persona text not null default 'default',
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calls_status_idx on calls (status);
create index if not exists calls_created_at_idx on calls (created_at desc);

create table if not exists transcript_messages (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls (id) on delete cascade,
  speaker text not null check (speaker in ('caller', 'scamsink', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists transcript_messages_call_id_idx
  on transcript_messages (call_id, created_at);

create table if not exists call_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls (id) on delete cascade,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists call_events_call_id_idx on call_events (call_id, created_at);
