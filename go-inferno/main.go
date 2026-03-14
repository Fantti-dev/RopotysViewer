// inferno_parser — parsii CS2-demon inferno (molotov/incendiary) liekkipisteet
// per frame ja kirjoittaa ne CSV:ksi.
//
// Käyttö:
//   inferno_parser.exe <demo.dem> <frames_out.csv> <meta_out.csv>
//
// frames_out.csv: unique_id, tick, x, y
// meta_out.csv:   unique_id, start_tick, end_tick, thrower_steamid, thrower_name
package main

import (
	"encoding/csv"
	"fmt"
	"os"
	"strconv"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
)

type infernoMeta struct {
	startTick int
	steamID   string
	name      string
}

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintln(os.Stderr, "käyttö: inferno_parser <demo.dem> <frames.csv> <meta.csv>")
		os.Exit(1)
	}

	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "virhe: %v\n", err)
		os.Exit(1)
	}
	defer f.Close()

	framesFile, err := os.Create(os.Args[2])
	if err != nil {
		fmt.Fprintf(os.Stderr, "virhe: %v\n", err)
		os.Exit(1)
	}
	defer framesFile.Close()
	framesW := csv.NewWriter(framesFile)
	framesW.Write([]string{"unique_id", "tick", "x", "y"})

	metaFile, err := os.Create(os.Args[3])
	if err != nil {
		fmt.Fprintf(os.Stderr, "virhe: %v\n", err)
		os.Exit(1)
	}
	defer metaFile.Close()
	metaW := csv.NewWriter(metaFile)
	metaW.Write([]string{"unique_id", "start_tick", "end_tick", "thrower_steamid", "thrower_name"})

	p := dem.NewParser(f)
	defer p.Close()

	metas := map[int64]infernoMeta{}

	p.RegisterEventHandler(func(e events.InfernoStart) {
		uid := e.Inferno.UniqueID()
		tick := p.GameState().IngameTick()
		steamID, name := "", ""
		if thr := e.Inferno.Thrower(); thr != nil {
			steamID = strconv.FormatUint(thr.SteamID64, 10)
			name = thr.Name
		}
		metas[uid] = infernoMeta{startTick: tick, steamID: steamID, name: name}
	})

	p.RegisterEventHandler(func(e events.InfernoExpired) {
		uid := e.Inferno.UniqueID()
		tick := p.GameState().IngameTick()
		meta := metas[uid]
		metaW.Write([]string{
			strconv.FormatInt(uid, 10),
			strconv.Itoa(meta.startTick),
			strconv.Itoa(tick),
			meta.steamID,
			meta.name,
		})
	})

	frameRows := 0
	for {
		more, err := p.ParseNextFrame()
		if err != nil {
			// ErrUnexpectedEndOfDemo on normaali CS2-demoille
			break
		}
		tick := p.GameState().IngameTick()
		for _, inferno := range p.GameState().Infernos() {
			uid := inferno.UniqueID()
			for _, fire := range inferno.Fires().Active().List() {
				framesW.Write([]string{
					strconv.FormatInt(uid, 10),
					strconv.Itoa(tick),
					strconv.FormatFloat(float64(fire.Vector.X), 'f', 1, 32),
					strconv.FormatFloat(float64(fire.Vector.Y), 'f', 1, 32),
				})
				frameRows++
			}
		}
		if !more {
			break
		}
	}

	framesW.Flush()
	metaW.Flush()
	fmt.Fprintf(os.Stderr, "inferno_parser: %d liekkipisterivi, %d infernoita\n", frameRows, len(metas))
}
