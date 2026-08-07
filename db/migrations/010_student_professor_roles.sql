-- Simplify application authorization to student and professor roles.
-- Clerk publicMetadata.role is authoritative; user_roles is a database-side
-- projection used by reviewer-integrity and approved-import constraints.
-- migration-safety: destructive

delete from user_roles
where role_id = 'admin';

delete from roles
where id = 'admin';

create or replace function app_user_can_review(target_user_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from users u
    where u.id = target_user_id
      and u.status = 'active'
      and (
        u.user_type = 'system'
        or exists (
          select 1
          from user_roles ur
          where ur.user_id = u.id
            and ur.role_id = 'professor'
            and ur.revoked_at is null
            and (ur.expires_at is null or ur.expires_at > now())
        )
      )
  );
$$;

create or replace function app_enforce_question_reviewer()
returns trigger
language plpgsql
as $$
begin
  if new.review_status <> 'needs_review'
    and not app_user_can_review(new.reviewed_by_user_id)
  then
    raise exception 'Question review decisions require an active professor identity';
  end if;

  return new;
end;
$$;
