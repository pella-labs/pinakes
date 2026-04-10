# Event Storming

## What It Is

A collaborative workshop technique for discovering domain events, commands, and aggregates. Created by Alberto Brandolini.

## Process

1. **Chaotic exploration** — everyone writes domain events on orange stickies
2. **Timeline** — arrange events chronologically
3. **Commands** — add blue stickies for what triggers each event
4. **Aggregates** — group events by the entity that owns them (yellow)
5. **Bounded contexts** — draw boundaries around clusters
6. **Policies** — add lilac stickies for automated reactions ("when X happens, do Y")

## Materials Needed

- A very long wall (or virtual whiteboard)
- Unlimited sticky notes in multiple colors
- Domain experts + developers in the same room

## Output

- A shared understanding of the domain
- Identified bounded contexts
- Candidate aggregates and entities
- A map of domain events and commands

## Tips

- Invite domain experts, not just developers
- Start with the "happy path" then explore edge cases
- Don't try to model everything — focus on the core domain

See [[arch-006]], [[arch-007]], [[arch-022]].
