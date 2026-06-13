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
