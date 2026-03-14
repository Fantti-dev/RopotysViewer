-- ============================================================
--  CS2 Demo Review Tool — SQL Server Schema
--  Aja tämä SQL Server Management Studio:ssa (SSMS)
--  TAI: sqlcmd -S localhost -E -i setup_database.sql
-- ============================================================

-- 1. Luo tietokanta (jos ei ole)
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'cs2demos')
BEGIN
    CREATE DATABASE cs2demos;
    PRINT '✅ Tietokanta cs2demos luotu';
END
ELSE
    PRINT '⚠️  Tietokanta cs2demos on jo olemassa';
GO

USE cs2demos;
GO

-- ============================================================
--  DEMOS — yksi rivi per parsittu .dem-tiedosto
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='demos' AND xtype='U')
BEGIN
    CREATE TABLE demos (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        filename    NVARCHAR(255)   NOT NULL,
        map_name    NVARCHAR(100)   NOT NULL,
        tickrate    INT             NOT NULL DEFAULT 64,
        server_name NVARCHAR(255)   NULL,
        match_id    NVARCHAR(100)   NULL,
        parsed_at   DATETIME        NOT NULL DEFAULT GETDATE()
    );
    PRINT '✅ Taulu demos luotu';
END
GO

-- ============================================================
--  PLAYERS — pelaajat per demo
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='players' AND xtype='U')
BEGIN
    CREATE TABLE players (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        demo_id     INT             NOT NULL REFERENCES demos(id),
        steam_id    NVARCHAR(30)    NOT NULL,
        name        NVARCHAR(100)   NOT NULL,
        team_start  NVARCHAR(10)    NOT NULL   -- 'CT' tai 'T'
    );
    CREATE INDEX IX_players_demo ON players(demo_id);
    PRINT '✅ Taulu players luotu';
END
GO

-- ============================================================
--  ROUNDS
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='rounds' AND xtype='U')
BEGIN
    CREATE TABLE rounds (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        demo_id      INT             NOT NULL REFERENCES demos(id),
        round_num    INT             NOT NULL,
        winner_team  NVARCHAR(10)    NULL,   -- 'CT' / 'T'
        win_reason   NVARCHAR(50)    NULL,   -- 'elimination','bomb_exploded','bomb_defused','time'
        round_type   NVARCHAR(20)    NULL,   -- 'pistol','eco','force','full'
        t_score      INT             NOT NULL DEFAULT 0,
        ct_score     INT             NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_rounds_demo ON rounds(demo_id);
    PRINT '✅ Taulu rounds luotu';
END
GO

-- ============================================================
--  POSITIONS — ISOIN TAULU, kriittiset indeksit!
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='positions' AND xtype='U')
BEGIN
    CREATE TABLE positions (
        id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        demo_id         INT             NOT NULL,
        round_num       INT             NOT NULL,
        tick            INT             NOT NULL,
        steam_id        NVARCHAR(30)    NOT NULL,
        x               FLOAT           NOT NULL,
        y               FLOAT           NOT NULL,
        z               FLOAT           NOT NULL,
        yaw             FLOAT           NOT NULL DEFAULT 0,
        pitch           FLOAT           NOT NULL DEFAULT 0,
        velocity_x      FLOAT           NOT NULL DEFAULT 0,
        velocity_y      FLOAT           NOT NULL DEFAULT 0,
        velocity_z      FLOAT           NOT NULL DEFAULT 0,
        is_alive        BIT             NOT NULL DEFAULT 1,
        is_ducking      BIT             NOT NULL DEFAULT 0,
        is_scoped       BIT             NOT NULL DEFAULT 0,
        is_airborne     BIT             NOT NULL DEFAULT 0,
        is_blinded      BIT             NOT NULL DEFAULT 0,
        health          INT             NOT NULL DEFAULT 100,
        armor           INT             NOT NULL DEFAULT 0,
        helmet          BIT             NOT NULL DEFAULT 0,
        active_weapon   NVARCHAR(50)    NULL,
        equip_value     INT             NOT NULL DEFAULT 0
    );
    -- KRIITTINEN: Ilman tätä indeksiä jokainen replay-query kestää sekunteja
    CREATE INDEX IX_positions_demo_round_tick
        ON positions(demo_id, round_num, tick)
        INCLUDE (steam_id, x, y, z, yaw, is_alive, health);
    PRINT '✅ Taulu positions luotu (indeksit OK)';
END
GO

-- ============================================================
--  KILLS
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='kills' AND xtype='U')
BEGIN
    CREATE TABLE kills (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        demo_id             INT             NOT NULL,
        round_num           INT             NOT NULL,
        tick                INT             NOT NULL,
        attacker_steam_id   NVARCHAR(30)    NULL,
        victim_steam_id     NVARCHAR(30)    NULL,
        assister_steam_id   NVARCHAR(30)    NULL,
        weapon              NVARCHAR(50)    NULL,
        headshot            BIT             NOT NULL DEFAULT 0,
        wallbang            BIT             NOT NULL DEFAULT 0,
        noscope             BIT             NOT NULL DEFAULT 0,
        thrusmoke           BIT             NOT NULL DEFAULT 0,
        blind               BIT             NOT NULL DEFAULT 0,
        attacker_x          FLOAT           NULL,
        attacker_y          FLOAT           NULL,
        victim_x            FLOAT           NULL,
        victim_y            FLOAT           NULL
    );
    CREATE INDEX IX_kills_demo_round ON kills(demo_id, round_num);
    PRINT '✅ Taulu kills luotu';
END
GO

-- ============================================================
--  DAMAGE
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='damage' AND xtype='U')
BEGIN
    CREATE TABLE damage (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        demo_id             INT             NOT NULL,
        round_num           INT             NOT NULL,
        tick                INT             NOT NULL,
        attacker_steam_id   NVARCHAR(30)    NULL,
        victim_steam_id     NVARCHAR(30)    NULL,
        weapon              NVARCHAR(50)    NULL,
        damage              INT             NOT NULL DEFAULT 0,
        hitgroup            NVARCHAR(30)    NULL,
        armor_damage        INT             NOT NULL DEFAULT 0,
        health_after        INT             NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_damage_demo_round ON damage(demo_id, round_num);
    PRINT '✅ Taulu damage luotu';
END
GO

-- ============================================================
--  GRENADES
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='grenades' AND xtype='U')
BEGIN
    CREATE TABLE grenades (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        demo_id             INT             NOT NULL,
        round_num           INT             NOT NULL,
        tick_thrown         INT             NOT NULL,
        tick_detonated      INT             NULL,
        thrower_steam_id    NVARCHAR(30)    NULL,
        grenade_type        NVARCHAR(30)    NOT NULL,  -- smokegrenade, flashbang, hegrenade, molotov, incgrenade, decoy
        throw_x             FLOAT           NOT NULL DEFAULT 0,
        throw_y             FLOAT           NOT NULL DEFAULT 0,
        throw_z             FLOAT           NOT NULL DEFAULT 0,
        detonate_x          FLOAT           NULL,
        detonate_y          FLOAT           NULL,
        detonate_z          FLOAT           NULL
    );
    CREATE INDEX IX_grenades_demo_round ON grenades(demo_id, round_num);
    PRINT '✅ Taulu grenades luotu';
END
GO

-- ============================================================
--  GRENADE TRAJECTORIES — lentoradat
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='grenade_trajectories' AND xtype='U')
BEGIN
    CREATE TABLE grenade_trajectories (
        id          BIGINT IDENTITY(1,1) PRIMARY KEY,
        grenade_id  INT     NOT NULL REFERENCES grenades(id),
        tick        INT     NOT NULL,
        x           FLOAT   NOT NULL,
        y           FLOAT   NOT NULL,
        z           FLOAT   NOT NULL
    );
    CREATE INDEX IX_grenade_traj ON grenade_trajectories(grenade_id, tick);
    PRINT '✅ Taulu grenade_trajectories luotu';
END
GO

-- ============================================================
--  SMOKE EFFECTS — savun efektialue + kesto
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='smoke_effects' AND xtype='U')
BEGIN
    CREATE TABLE smoke_effects (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        grenade_id  INT     NOT NULL REFERENCES grenades(id),
        start_tick  INT     NOT NULL,
        end_tick    INT     NOT NULL,
        x           FLOAT   NOT NULL,
        y           FLOAT   NOT NULL,
        z           FLOAT   NOT NULL,
        radius      FLOAT   NOT NULL DEFAULT 115.0
    );
    PRINT '✅ Taulu smoke_effects luotu';
END
GO

-- ============================================================
--  FLASH EVENTS
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='flash_events' AND xtype='U')
BEGIN
    CREATE TABLE flash_events (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        demo_id             INT             NOT NULL,
        round_num           INT             NOT NULL,
        tick                INT             NOT NULL,
        thrower_steam_id    NVARCHAR(30)    NULL,
        blinded_steam_id    NVARCHAR(30)    NULL,
        flash_duration      FLOAT           NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_flash_demo_round ON flash_events(demo_id, round_num);
    PRINT '✅ Taulu flash_events luotu';
END
GO

-- ============================================================
--  BOMB EVENTS
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='bomb_events' AND xtype='U')
BEGIN
    CREATE TABLE bomb_events (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        demo_id             INT             NOT NULL,
        round_num           INT             NOT NULL,
        event_type          NVARCHAR(20)    NOT NULL, -- plant, defuse, explode, defuse_start, defuse_abort
        tick                INT             NOT NULL,
        player_steam_id     NVARCHAR(30)    NULL,
        site                NVARCHAR(5)     NULL,     -- 'A' tai 'B'
        x                   FLOAT           NOT NULL DEFAULT 0,
        y                   FLOAT           NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_bomb_demo_round ON bomb_events(demo_id, round_num);
    PRINT '✅ Taulu bomb_events luotu';
END
GO

-- ============================================================
--  SHOTS FIRED — laukaukset spray-analyysiä varten
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='shots_fired' AND xtype='U')
BEGIN
    CREATE TABLE shots_fired (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        demo_id     INT             NOT NULL,
        round_num   INT             NOT NULL,
        tick        INT             NOT NULL,
        steam_id    NVARCHAR(30)    NULL,
        weapon      NVARCHAR(50)    NULL,
        x           FLOAT           NOT NULL DEFAULT 0,
        y           FLOAT           NOT NULL DEFAULT 0,
        z           FLOAT           NOT NULL DEFAULT 0,
        yaw         FLOAT           NOT NULL DEFAULT 0,
        pitch       FLOAT           NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_shots_demo_round ON shots_fired(demo_id, round_num);
    PRINT '✅ Taulu shots_fired luotu';
END
GO

-- ============================================================
--  PURCHASES — ostot per round
-- ============================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='purchases' AND xtype='U')
BEGIN
    CREATE TABLE purchases (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        demo_id     INT             NOT NULL,
        round_num   INT             NOT NULL,
        tick        INT             NOT NULL,
        steam_id    NVARCHAR(30)    NULL,
        item        NVARCHAR(100)   NULL
    );
    CREATE INDEX IX_purchases_demo_round ON purchases(demo_id, round_num);
    PRINT '✅ Taulu purchases luotu';
END
GO

PRINT '';
PRINT '============================================================';
PRINT '✅ KAIKKI TAULUT LUOTU ONNISTUNEESTI!';
PRINT '   Tietokanta: cs2demos';
PRINT '   Taulut: demos, players, rounds, positions, kills,';
PRINT '           damage, grenades, grenade_trajectories,';
PRINT '           smoke_effects, flash_events, bomb_events,';
PRINT '           shots_fired, purchases';
PRINT '============================================================';
GO
