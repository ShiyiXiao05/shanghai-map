import { categoryMeta } from './config.js';

export const EMOJI_GROUPS = [
  { name: '美食饮品', emojis: ['🍜', '☕', '🍰', '🍣', '🍕', '🍔', '🥟', '🍲', '🍻', '🍵', '🧋', '🥤', '🍷', '🍸', '🍦', '🍩', '🍪', '🥐', '🥯', '🥖', '🥪', '🌮', '🍝', '🍱', '🍛', '🍢', '🍤', '🥩', '🥗', '🍓', '🍒', '🍉'] },
  { name: '自然风景', emojis: ['🏞️', '🌳', '🌸', '🏖️', '🌲', '🌴', '🌿', '🌻', '🌷', '🌹', '🪷', '🍁', '🍂', '🍀', '⛰️', '🏔️', '🌋', '🏝️', '🌊', '🌅', '🌇', '🌈', '☀️', '🌙', '🦋', '🐈', '🐕', '🐼'] },
  { name: '城市建筑', emojis: ['🏛️', '🌆', '🌉', '🏰', '🏙️', '🗼', '🏯', '⛩️', '⛪', '🕌', '🏠', '🏡', '🏨', '🏢', '🏫', '🏟️', '⛲', '🎠', '🎪', '🚉'] },
  { name: '文艺娱乐', emojis: ['🎡', '🎨', '📚', '🎭', '🎬', '🎵', '🎮', '⚽', '🎢', '🎤', '🎸', '🎹', '🎻', '🎧', '📷', '🎳', '🏀', '🏸', '🎾', '🏊', '🧗', '⛸️', '🛼', '🪁'] },
  { name: '购物出行', emojis: ['🛍️', '💎', '👗', '👟', '💄', '🧸', '🎁', '💐', '🚲', '🛵', '🚗', '🚕', '🚌', '🚇', '🚄', '✈️', '⛵', '🚢', '⛺', '🧳'] },
  { name: '心情标记', emojis: ['📍', '❤️', '⭐', '✨', '💛', '💚', '💙', '💜', '🧡', '🤍', '🔥', '💯', '👍', '😊', '🥰', '😎', '🥳', '🤩', '💌', '🏆'] },
];

export function displayEmoji(place) {
  return (place && typeof place.emoji === 'string' && place.emoji.trim()) || categoryMeta(place && place.category).emoji;
}

export function validEmoji(value) {
  if (typeof value !== 'string' || value.length > 32) return false;
  if (!value) return true;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value));
    if (segments.length !== 1) return false;
  }
  // Explicit sequence grammar also works in base libraries without Intl.Segmenter.
  const base = '(?:[\\u{1F000}-\\u{1FAFF}\\u2300-\\u27FF\\u00A9\\u00AE\\u2B50\\u2B55\\u3030\\u303D\\u3297\\u3299])';
  const unit = `${base}[\\uFE0E\\uFE0F]?[\\u{1F3FB}-\\u{1F3FF}]?`;
  return new RegExp(`^(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|[0-9#*]\\uFE0F?\\u20E3|${unit}(?:\\u200D${unit})*)$`, 'u').test(value);
}
