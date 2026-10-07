-- Per-user preferences: interface language and theme mode.
--
-- Both live on the user's profile, so they follow the user to any browser.
--   language  'es' (base language, the default) or 'en'
--   theme     'green' (the current Tecfys palette, the default) or 'blue'
--             (blue / white mode: stored and applied as data-theme, its palette
--             is defined later in src/app/globals.css)
--
-- Text with a check constraint rather than an enum: adding a language or a theme
-- is then a one-line change of the constraint. Existing users get the defaults.
-- profiles keeps its conventions: RLS on with no policies, access through the
-- service role only (re-stated here).

alter table profiles
  add column if not exists language text not null default 'es',
  add column if not exists theme    text not null default 'green';

alter table profiles drop constraint if exists profiles_language_check;
alter table profiles add constraint profiles_language_check check (language in ('es', 'en'));
alter table profiles drop constraint if exists profiles_theme_check;
alter table profiles add constraint profiles_theme_check check (theme in ('green', 'blue'));

comment on column profiles.language is 'Interface language chosen by the user (es = base, en)';
comment on column profiles.theme is 'Theme mode chosen by the user (green = current palette, blue = blue / white)';

grant all on table profiles to service_role;
