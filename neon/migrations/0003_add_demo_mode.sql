-- Distinguishes which scripted demo mode an outbound_demo call used (or
-- null for real inbound calls and any legacy outbound_demo rows created
-- before this mode existed, which fall back to 'scam_honeypot' behavior).
alter table calls
  add column if not exists demo_mode text
  check (demo_mode in ('scam_honeypot', 'infrastructure_simulation'));
