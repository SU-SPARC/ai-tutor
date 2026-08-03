-- Auth.js application-session invalidation and anonymous progress claims.
-- Provider access/refresh tokens are deliberately not persisted.

alter table users
  add column session_version integer not null default 1;

alter table users
  add constraint users_session_version_positive check (session_version > 0);

create table anonymous_identity_claims (
  anonymous_subject_hash text primary key,
  claimed_by_user_id text not null references users(id) on delete restrict,
  source text not null check (
    source in ('signed_cookie', 'legacy_local_storage')
  ),
  migrated_session_count integer not null default 0 check (
    migrated_session_count >= 0
  ),
  claimed_at timestamptz not null default now(),
  constraint anonymous_identity_claims_hash_check check (
    anonymous_subject_hash ~ '^[0-9a-f]{64}$'
  )
);

create index anonymous_identity_claims_user_idx
  on anonymous_identity_claims (claimed_by_user_id, claimed_at desc);
