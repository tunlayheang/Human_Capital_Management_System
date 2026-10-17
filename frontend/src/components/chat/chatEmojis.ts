export type EmojiCategory = {
  id: string;
  label: string;
  emojis: string[];
};

/** Curated set — keeps bundle small while covering common chat use */
export const CHAT_EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '🙂', '😉',
      '😍', '🥰', '😘', '😋', '😜', '🤔', '😐', '😑', '😶', '🙄',
      '😏', '😣', '😥', '😮', '😯', '😴', '🤤', '😭', '😱', '🥺',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    emojis: [
      '👍', '👎', '👏', '🙌', '🤝', '🙏', '💪', '✌️', '🤞', '🤟',
      '👋', '🤚', '👌', '🫶', '❤️', '🔥', '✨', '⭐', '💯', '🎉',
    ],
  },
  {
    id: 'work',
    label: 'Work',
    emojis: [
      '💼', '📎', '📌', '📝', '✅', '❌', '⚠️', '❓', '❗', '💡',
      '📅', '📆', '⏰', '🕐', '📧', '📞', '💬', '🗂️', '📊', '🎯',
    ],
  },
  {
    id: 'people',
    label: 'People',
    emojis: [
      '👤', '👥', '🧑‍💼', '👨‍💻', '👩‍💻', '🧑‍🤝‍🧑', '👨‍👩‍👧', '🙋', '🙋‍♂️', '🙋‍♀️',
      '🤷', '🤷‍♂️', '🤷‍♀️', '💁', '🧠', '👀', '💬', '🗣️', '🫡', '😎',
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    emojis: [
      '🌞', '🌙', '⭐', '🌈', '☁️', '🌧️', '❄️', '🌸', '🌺', '🍀',
      '🌳', '🐶', '🐱', '🐻', '🦋', '🐝', '🍎', '🍕', '☕', '🍺',
    ],
  },
];
