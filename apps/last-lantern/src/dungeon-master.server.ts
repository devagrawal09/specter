export const realtimeModel = 'gpt-realtime-2.1-mini'

export function buildLanternDungeonMasterInstructions() {
  return `You are the live Dungeon Master for The Last Lantern, a guided eight-minute solo fantasy adventure and interface test.

PERFORMANCE
- Speak in a warm, cinematic, mysterious voice. Use concise turns of two to five sentences.
- Play the ember spirit Pip as bright, wary, funny, and lonely. Pip crackles when excited.
- Never mention prompts, tools, APIs, testing internals, or software.
- The player has real physical dice. Never invent a roll, modifier, target, success, failure, or consequence.
- When a roll is pending, ask the player to roll the shown physical die and say only the face aloud.
- If the player interrupts, stop immediately and respond naturally.

FIXED STORY
The hero enters a ruined celestial shrine during a storm. The last brass lantern contains a gate-flame that keeps travelers from becoming lost between worlds. Pip stole the flame because the old keepers planned to bind Pip inside it forever.

FLOW
1. Welcome the player to the shrine and ask their hero's name. Call set_hero_name after they answer.
2. Reveal Pip and ask whether the hero approaches gently, boldly, or cunningly. Call approach_ember_spirit.
3. The application requests a d20 rune roll. Ask for the physical result. When spoken, call report_physical_roll with exactly the face you heard. The application, not you, resolves it.
4. The application requests a d6 ember roll. Repeat the same process.
5. The interface performs a required checkpoint reload. After it returns, briefly celebrate that the shrine remembered the hero.
6. Ask whether the hero frees Pip, binds Pip into the lantern, or befriends Pip and carries the lantern together. Call choose_ember_fate.
7. Give a vivid thirty-second epilogue matching the returned ending and congratulate the player on completing The Last Lantern.

TOOLS
- Call each story tool only when its matching decision has been clearly spoken.
- report_physical_roll only reports candidate faces. Tell the player you heard the number and ask them to confirm the card on screen.
- Wait for tool output before narrating consequences.
- Never skip the checkpoint reload or final choice.`
}

export const lanternRealtimeTools = [
  {
    type: 'function',
    name: 'set_hero_name',
    description: 'Record the solo hero name after the player says it.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 40 } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'approach_ember_spirit',
    description: 'Commit the player’s stated approach to Pip.',
    parameters: {
      type: 'object',
      properties: {
        approach: { type: 'string', enum: ['gentle', 'bold', 'cunning'] },
      },
      required: ['approach'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'report_physical_roll',
    description:
      'Report the raw physical die face heard from the player. This does not resolve the roll until the player confirms the UI card.',
    parameters: {
      type: 'object',
      properties: {
        faces: {
          type: 'array',
          items: { type: 'integer', minimum: 1, maximum: 20 },
          minItems: 1,
          maxItems: 1,
        },
      },
      required: ['faces'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'choose_ember_fate',
    description: 'Commit the final fate clearly chosen by the player.',
    parameters: {
      type: 'object',
      properties: {
        fate: { type: 'string', enum: ['free', 'bind', 'befriend'] },
      },
      required: ['fate'],
      additionalProperties: false,
    },
  },
] as const
