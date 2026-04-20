/**
 * Short one-line greetings shown in a speech bubble above a visiting pet
 * when it arrives. Picked at random so repeat visits feel fresh.
 *
 * Keep lines short (≤ ~24 chars) so the bubble doesn't overflow the
 * 96×96 sprite column.
 */
export const VISITOR_GREETINGS: readonly string[] = [
  "Hi there, how are you?",
  "Hey! Nice to see you",
  "Hello friend!",
  "Just dropping by \u{1F44B}",
  "Came to say hi!",
  "Woof! \u{1F436}",
  "Can I hang out?",
  "Miss me already?",
  "Long time no bark!",
  "What's up?",
  "Ready to play?",
  "Good to see you!",
  "Hi pal!",
  "Hey, how's it going?",
  "Surprise visit!",
  "Bark bark!",
];

export function randomGreeting(): string {
  const i = Math.floor(Math.random() * VISITOR_GREETINGS.length);
  return VISITOR_GREETINGS[i];
}
