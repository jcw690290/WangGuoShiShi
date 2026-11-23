create schema wgss_private;
revoke all on schema wgss_private from public;
grant usage on schema wgss_private to authenticated;

create table wgss_private.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  host uuid not null references auth.users on delete cascade,
  version bigint not null default 0,
  speed integer not null default 0 check (speed in (0, 1000, 2000, 4000)),
  lease uuid,
  lease_until timestamptz,
  checkpoint_version bigint not null default 0,
  snapshot text,
  day jsonb
);
create index wgss_room_host on wgss_private.rooms (host);
create table wgss_private.members (
  room uuid not null references wgss_private.rooms on delete cascade,
  player uuid not null references auth.users on delete cascade,
  country text check (country ~ '^country_(0[1-9]|1[0-9]|2[0-9])$'),
  primary key (room, player),
  unique (room, country)
);
create index wgss_member_player on wgss_private.members (player);
create table wgss_private.commands (
  id bigint generated always as identity primary key,
  room uuid not null,
  player uuid not null,
  country text not null,
  nonce uuid not null,
  command jsonb not null,
  done boolean not null default false,
  error text,
  foreign key (room, player) references wgss_private.members on delete cascade,
  unique (room, player, nonce)
);
create index wgss_pending_commands on wgss_private.commands (room, id) where not done;
create index wgss_player_results on wgss_private.commands (room, player, id desc) where done;

alter table wgss_private.rooms enable row level security;
alter table wgss_private.members enable row level security;
alter table wgss_private.commands enable row level security;

create function wgss_private.can_receive(topic text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from wgss_private.members
    where player = (select auth.uid())
      and room = case when topic ~ '^wgss:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then substr(topic, 6)::uuid end
  )
$$;
revoke all on function wgss_private.can_receive(text) from public;
grant execute on function wgss_private.can_receive(text) to authenticated;

create policy wgss_room_realtime_read on realtime.messages for select to authenticated
using (
  (select realtime.topic()) like 'wgss:%'
  and extension in ('broadcast', 'presence')
  and (select wgss_private.can_receive(realtime.topic()))
);
create policy wgss_room_presence_write on realtime.messages for insert to authenticated
with check (
  (select realtime.topic()) like 'wgss:%'
  and extension = 'presence'
  and (select wgss_private.can_receive(realtime.topic()))
);

create function wgss_private.notify(room_id uuid) returns void
language sql set search_path = ''
as $$
  select realtime.send('{}'::jsonb, 'changed', 'wgss:' || room_id::text, true)
$$;
revoke all on function wgss_private.notify(uuid) from public;

create function wgss_private.online(action text, args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r wgss_private.rooms;
  member wgss_private.members;
  cid bigint;
  new_snapshot text := args->>'snapshot';
  new_day jsonb := args->'day';
  token uuid := (args->>'lease')::uuid;
  now_at timestamptz := clock_timestamp();
begin
  if uid is null then raise exception '请先登录联机服务'; end if;

  if action = 'create' then
    perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
    if (select count(*) from wgss_private.rooms where host = uid) >= 20 then
      raise exception '已达到每位房主 20 个房间的上限';
    end if;
    insert into wgss_private.rooms (host) values (uid) returning * into r;
    insert into wgss_private.members (room, player) values (r.id, uid);
    return to_jsonb(r.id);
  end if;

  if action = 'join' then
    select * into r from wgss_private.rooms where code = upper(trim(args->>'code')) for update;
    if not found then raise exception '房间不存在'; end if;
    if exists (select 1 from wgss_private.members where room = r.id and player = uid) then
      return to_jsonb(r.id);
    end if;
    if r.snapshot is not null then raise exception '游戏已开始，仅原有玩家可续玩'; end if;
    if (select count(*) from wgss_private.members where room = r.id) >= 8 then
      raise exception '房间已满';
    end if;
    insert into wgss_private.members (room, player) values (r.id, uid);
    update wgss_private.rooms set version = version + 1 where id = r.id;
    perform wgss_private.notify(r.id);
    return to_jsonb(r.id);
  end if;

  if action = 'read' then
    select * into r from wgss_private.rooms where id = (args->>'room')::uuid;
  else
    select * into r from wgss_private.rooms where id = (args->>'room')::uuid for update;
    now_at := clock_timestamp();
  end if;
  select * into member from wgss_private.members where room = r.id and player = uid;
  if not found then raise exception '房间不存在或你没有加入'; end if;

  if action = 'read' then
    return jsonb_build_object(
      'id', r.id, 'code', r.code, 'host', r.host, 'scenario', 'world-1820', 'protocol', 1,
      'version', r.version, 'speed', r.speed,
      'status', case when r.snapshot is null then 'lobby' else 'playing' end,
      'hostOnline', coalesce(r.lease_until > now_at, false),
      'members', (select jsonb_agg(jsonb_build_object('user', player, 'country', country) order by player)
        from wgss_private.members where room = r.id),
      'checkpointVersion', r.checkpoint_version,
      'snapshot', case when r.checkpoint_version is distinct from (args->>'checkpoint')::bigint
        then r.snapshot end,
      'day', r.day,
      'pending', case when r.host = uid then coalesce((
        select jsonb_agg(to_jsonb(q) order by q.id) from (
          select id, country, command from wgss_private.commands where room = r.id and not done order by id limit 20
        ) q), '[]'::jsonb) else '[]'::jsonb end,
      'results', coalesce((select jsonb_agg(to_jsonb(q)) from (
        select id, error from wgss_private.commands where room = r.id and player = uid and done order by id desc limit 20
      ) q), '[]'::jsonb)
    );
  end if;

  if action = 'country' then
    if r.snapshot is not null then raise exception '游戏开始后无法换国'; end if;
    if (args->>'country') is null or (args->>'country') !~ '^country_(0[1-9]|1[0-9]|2[0-9])$' then
      raise exception '请选择剧本内国家';
    end if;
    if exists (select 1 from wgss_private.members where room = r.id and country = args->>'country' and player <> uid) then
      raise exception '国家已被选择';
    end if;
    update wgss_private.members set country = args->>'country' where room = r.id and player = uid;
    update wgss_private.rooms set version = version + 1 where id = r.id;
  elsif action = 'leave' then
    if r.snapshot is not null then raise exception '游戏开始后保留玩家席位'; end if;
    if r.host = uid then
      -- Keep the lobby available to invited friends when the host leaves the page.
      if token is not null and r.lease = token then
        update wgss_private.rooms set lease = null, lease_until = null where id = r.id;
      end if;
    else
      delete from wgss_private.members where room = r.id and player = uid;
      update wgss_private.rooms set version = version + 1 where id = r.id;
    end if;
  elsif action = 'submit' then
    if r.snapshot is null or member.country is null then raise exception '联机对局尚未开始'; end if;
    select id into cid from wgss_private.commands
      where room = r.id and player = uid and nonce = (args->>'nonce')::uuid;
    if found then return to_jsonb(cid); end if;
    if r.lease_until is null or r.lease_until <= now_at then raise exception '房主离线，指令暂不可提交'; end if;
    if jsonb_typeof(args->'command') is distinct from 'object' or octet_length(args->>'command') > 2048 then
      raise exception '指令格式无效';
    end if;
    if (select count(*) from wgss_private.commands where room = r.id and player = uid and not done) >= 10 then
      raise exception '请等待房主处理待执行指令';
    end if;
    insert into wgss_private.commands (room, player, country, nonce, command)
      values (r.id, uid, member.country, (args->>'nonce')::uuid, args->'command') returning id into cid;
    perform wgss_private.notify(r.id);
    return to_jsonb(cid);
  else
    if uid <> r.host or token is null then raise exception '此操作仅限房主'; end if;
    if action = 'lease' then
      if r.lease_until > now_at then
        if r.lease is distinct from token then return 'false'::jsonb; end if;
        update wgss_private.rooms set lease_until = now_at + interval '15 seconds' where id = r.id;
        return 'true'::jsonb;
      end if;
      update wgss_private.rooms set lease = token, lease_until = now_at + interval '15 seconds',
        speed = 0, version = version + 1 where id = r.id;
    else
      if r.lease is distinct from token or r.lease_until is null or r.lease_until <= now_at then
        return 'false'::jsonb;
      end if;
      if action = 'release' then
        update wgss_private.rooms set lease = null, lease_until = null, speed = 0, version = version + 1 where id = r.id;
      elsif action = 'speed' then
        if r.snapshot is null then raise exception '请先开始对局'; end if;
        update wgss_private.rooms set speed = (args->>'speed')::integer, version = version + 1 where id = r.id;
      elsif action in ('start', 'commit') then
        if r.version is distinct from (args->>'version')::bigint then return 'false'::jsonb; end if;
        if new_snapshot is not null and octet_length(new_snapshot) not between 1 and 2000000 then
          raise exception '世界存档大小无效';
        end if;
        if new_day is not null and (
          jsonb_typeof(new_day) <> 'object' or jsonb_typeof(new_day->'elapsedDays') is distinct from 'number'
          or not (new_day ? 'borderDispute') or octet_length(new_day::text) > 8192
        ) then raise exception '日步进状态无效'; end if;

        if action = 'start' then
          if r.snapshot is not null then return 'false'::jsonb; end if;
          if new_snapshot is null or new_day is not null then raise exception '缺少开局存档'; end if;
          if (select count(*) from wgss_private.members where room = r.id) < 2
            or exists (select 1 from wgss_private.members where room = r.id and country is null) then
            raise exception '至少两位玩家均选国后才能开始';
          end if;
        else
          if r.snapshot is null then raise exception '请先开始对局'; end if;
          cid := (args->>'commandId')::bigint;
          if cid is not null then
            if cid is distinct from (select min(id) from wgss_private.commands where room = r.id and not done) then
              return 'false'::jsonb;
            end if;
            if new_day is not null or (new_snapshot is null) = ((args->>'error') is null) then
              raise exception '指令结算结果无效';
            end if;
            update wgss_private.commands set done = true, error = left(args->>'error', 256) where id = cid;
          elsif r.speed = 0 or (new_day is null) = (new_snapshot is null)
            or exists (select 1 from wgss_private.commands where room = r.id and not done) then
            return 'false'::jsonb;
          end if;
        end if;
        update wgss_private.rooms set
          version = version + 1,
          checkpoint_version = case when new_snapshot is not null then version + 1 else checkpoint_version end,
          snapshot = coalesce(new_snapshot, snapshot),
          day = case when new_snapshot is not null then null else coalesce(new_day, day) end,
          speed = case when args->>'pause' = 'true' then 0 else speed end
        where id = r.id;
      else
        raise exception '未知联机操作';
      end if;
    end if;
  end if;
  perform wgss_private.notify(r.id);
  return 'true'::jsonb;
end;
$$;
revoke all on function wgss_private.online(text, jsonb) from public;
grant execute on function wgss_private.online(text, jsonb) to authenticated;

create function public.wgss_online(action text, args jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$ select wgss_private.online(action, args) $$;
revoke all on function public.wgss_online(text, jsonb) from public, anon;
grant execute on function public.wgss_online(text, jsonb) to authenticated;

