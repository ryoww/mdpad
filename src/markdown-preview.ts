import DOMPurify from "dompurify";
import { Marked } from "marked";

export const PREVIEW_CHARACTER_LIMIT = 2 * 1024 * 1024;

// U+FE0E (text presentation selector) を付けて、環境によって絵文字として色付きで
// 描かれるのを防ぐ。U+2611 だけ絵文字になると、済みと未着手で見え方が揃わなくなる。
const CHECKED_MARK = "☑︎";
const UNCHECKED_MARK = "☐︎";

// marked の既定は checkbox を <input disabled type="checkbox"> で返すが、
// ALLOWED_ATTR が空なので DOMPurify が要素ごと落とし、チェック状態が消える。
// 許可リストを緩める代わりに文字で表す。プレビューは読み取り専用で操作しないため、
// 無効化された input と伝わる情報は変わらない。
// 共有インスタンスの marked ではなく専用インスタンスに差し込み、上書きの影響を閉じ込める。
const previewMarked = new Marked({
  breaks: false,
  gfm: true,
  renderer: {
    checkbox({ checked }) {
      return `${checked ? CHECKED_MARK : UNCHECKED_MARK} `;
    },
  },
});

const previewTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

export function renderMarkdownPreview(source: string): DocumentFragment {
  const rendered = previewMarked.parse(source, { async: false }) as string;

  return DOMPurify.sanitize(rendered, {
    ALLOWED_ATTR: [],
    ALLOWED_TAGS: previewTags,
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;
}
