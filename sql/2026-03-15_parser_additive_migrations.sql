/*
  Additive schema updates for parser enhancements.
  Safe to run multiple times.
*/

IF COL_LENGTH('grenades','source_handle') IS NULL
  ALTER TABLE grenades ADD source_handle BIGINT NULL;

IF COL_LENGTH('grenades','intent_tick') IS NULL
  ALTER TABLE grenades ADD intent_tick INT NULL;

IF COL_LENGTH('grenades','intent_subtick') IS NULL
  ALTER TABLE grenades ADD intent_subtick FLOAT NULL;

IF COL_LENGTH('flash_events','match_quality') IS NULL
  ALTER TABLE flash_events ADD match_quality NVARCHAR(32) NULL;

IF COL_LENGTH('damage','source_grenade_id') IS NULL
  ALTER TABLE damage ADD source_grenade_id INT NULL;

IF COL_LENGTH('damage','source_inferno_grenade_id') IS NULL
  ALTER TABLE damage ADD source_inferno_grenade_id INT NULL;

IF OBJECT_ID('grenade_intents', 'U') IS NULL
BEGIN
  CREATE TABLE grenade_intents (
    id INT IDENTITY(1,1) PRIMARY KEY,
    demo_id INT NOT NULL,
    tick INT NOT NULL,
    subtick FLOAT NULL,
    thrower_steam_id NVARCHAR(64) NULL,
    source_handle BIGINT NULL,
    grenade_type_guess NVARCHAR(64) NULL,
    intent_source NVARCHAR(32) NOT NULL DEFAULT 'fallback_parse_grenades'
  );
END;

IF COL_LENGTH('demos','match_start_tick') IS NULL
  ALTER TABLE demos ADD match_start_tick INT NULL;

IF COL_LENGTH('rounds','is_knife') IS NULL
  ALTER TABLE rounds ADD is_knife BIT NOT NULL CONSTRAINT DF_rounds_is_knife DEFAULT 0;
