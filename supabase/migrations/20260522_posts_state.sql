-- Explicit state column on posts. The notification fan-out previously parsed
-- the state out of the free-text `address` string at notify time via
-- substring matching (lib/notifications.ts → extractStateFromAddress). That
-- failed for posts where Nominatim returned the state under an unexpected
-- form ("Federal Capital Territory" vs "FCT", hyphenated multi-word names,
-- etc.) — users on the "Specific states" alert mode silently missed those
-- alerts. Capturing state once at post creation makes the filter accurate
-- regardless of how the address string was formatted.
--
-- Stored as plain text (matches the format the in-app NIGERIAN_STATES list
-- uses). Nullable because some posts won't have a resolvable state (very
-- remote coordinates, Nominatim outage at create time). Code falls back to
-- the legacy substring matcher when state IS NULL.

alter table public.posts
  add column if not exists state text;

-- Backfill existing posts using substring matching on the address column.
-- Imperfect — matches the runtime behavior we had until now, so existing
-- "Specific states" users see no regression. Once this runs, every new
-- post sets state explicitly from the Nominatim structured response, so
-- this backfill is one-time.
--
-- Order doesn't matter because each UPDATE is gated by `state IS NULL`.
-- Each statement only fills rows that earlier statements left alone.

update public.posts set state = 'Abia'        where state is null and address ilike '%abia%';
update public.posts set state = 'Adamawa'     where state is null and address ilike '%adamawa%';
update public.posts set state = 'Akwa Ibom'   where state is null and (address ilike '%akwa ibom%' or address ilike '%akwa-ibom%');
update public.posts set state = 'Anambra'     where state is null and address ilike '%anambra%';
update public.posts set state = 'Bauchi'      where state is null and address ilike '%bauchi%';
update public.posts set state = 'Bayelsa'     where state is null and address ilike '%bayelsa%';
update public.posts set state = 'Benue'       where state is null and address ilike '%benue%';
update public.posts set state = 'Borno'       where state is null and address ilike '%borno%';
update public.posts set state = 'Cross River' where state is null and (address ilike '%cross river%' or address ilike '%cross-river%');
update public.posts set state = 'Delta'       where state is null and address ilike '%delta%';
update public.posts set state = 'Ebonyi'      where state is null and address ilike '%ebonyi%';
update public.posts set state = 'Edo'         where state is null and address ilike '%edo%';
update public.posts set state = 'Ekiti'       where state is null and address ilike '%ekiti%';
update public.posts set state = 'Enugu'       where state is null and address ilike '%enugu%';
update public.posts set state = 'FCT'         where state is null and (address ilike '%fct%' or address ilike '%federal capital territory%' or address ilike '%abuja%');
update public.posts set state = 'Gombe'       where state is null and address ilike '%gombe%';
update public.posts set state = 'Imo'         where state is null and address ilike '%imo%';
update public.posts set state = 'Jigawa'      where state is null and address ilike '%jigawa%';
update public.posts set state = 'Kaduna'      where state is null and address ilike '%kaduna%';
update public.posts set state = 'Kano'        where state is null and address ilike '%kano%';
update public.posts set state = 'Katsina'     where state is null and address ilike '%katsina%';
update public.posts set state = 'Kebbi'       where state is null and address ilike '%kebbi%';
update public.posts set state = 'Kogi'        where state is null and address ilike '%kogi%';
update public.posts set state = 'Kwara'       where state is null and address ilike '%kwara%';
update public.posts set state = 'Lagos'       where state is null and address ilike '%lagos%';
update public.posts set state = 'Nasarawa'    where state is null and address ilike '%nasarawa%';
update public.posts set state = 'Niger'       where state is null and address ilike '%niger%' and address not ilike '%nigeria%';
update public.posts set state = 'Ogun'        where state is null and address ilike '%ogun%';
update public.posts set state = 'Ondo'        where state is null and address ilike '%ondo%';
update public.posts set state = 'Osun'        where state is null and address ilike '%osun%';
update public.posts set state = 'Oyo'         where state is null and address ilike '%oyo%';
update public.posts set state = 'Plateau'     where state is null and address ilike '%plateau%';
update public.posts set state = 'Rivers'      where state is null and address ilike '%rivers%';
update public.posts set state = 'Sokoto'      where state is null and address ilike '%sokoto%';
update public.posts set state = 'Taraba'      where state is null and address ilike '%taraba%';
update public.posts set state = 'Yobe'        where state is null and address ilike '%yobe%';
update public.posts set state = 'Zamfara'     where state is null and address ilike '%zamfara%';
