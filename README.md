# War of the Ring — Digital Port (unofficial, fan-made)

An unofficial, non-commercial fan adaptation of **War of the Ring, Second
Edition** for online async and hotseat play. Base game, 2 players (Free Peoples
vs Shadow).

> *War of the Ring* is designed by Roberto Di Meglio, Marco Maggi & Francesco
> Nepitello and published by **Ares Games**, based on *The Lord of the Rings* by
> J.R.R. Tolkien. This project is **not affiliated with or endorsed by** Ares
> Games, Middle-earth Enterprises, or the Tolkien Estate.

## Art & assets — nothing copyrighted is distributed here

This repository contains **no publisher artwork and no rulebook PDFs**. It ships
only game *metadata* (rules-as-data) and a list of **URLs** pointing at the card
and board images already hosted publicly on Steam's CDN as part of the community
Tabletop Simulator mod *"War of the Ring 2E (Scripted by DevKev)"*.

On first run the app offers to **download those images directly from the
publisher/community hosting into your own browser**, where they are sliced and
cached locally (IndexedDB). You may also **skip the download** and play with
text placeholders — the game is fully functional either way. The art is never
served, bundled, or redistributed by this project.

If you own the physical game and want the original assets, please support **Ares
Games** by purchasing it.

## Status

Early development. See the implementation plan and the framework playbook for the
build sequence (pure engine + headless soak → server → UI → AI → live play).

## License

Code is MIT (see `LICENSE`). This license covers **only the original code in
this repository** — not *War of the Ring*, its rules, artwork, or trademarks,
which remain the property of their respective owners.


## Feedback & contributions

The most useful thing you can send is an **in-game problem report** — the report
button inside the game. Filed while you're playing, it captures the game state and
context that make an issue reproducible, which helps far more than a code change.

**Pull requests generally won't be merged.** This is a solo-maintained project, and
reviewing and integrating outside code costs more than it saves. If you open a PR,
it'll be read as a well-specified bug report or feature request and implemented here
rather than merged — so it's a fine way to *describe* a change you'd like, just
please don't expect it to land as-is.

**The whole codebase is MIT-licensed** — fork it and do whatever you want: change
the rules, reskin it, build and ship your own version. No permission needed; that's
the point of the license.
