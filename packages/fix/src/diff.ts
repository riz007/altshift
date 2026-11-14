export interface FileChange {
  path: string;
  before: string;
  after: string;
}

export interface LineDiff {
  added: string[];
  removed: string[];
}

const MAX_LCS_CELLS = 4_000_000;

/** Lines added and removed between two texts, by longest common subsequence. */
export function lineDiff(before: string, after: string): LineDiff {
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const left = a.slice(start, endA);
  const right = b.slice(start, endB);
  // Very large rewrites are counted in full. That over-counts, which only makes the scope gate stricter.
  if (left.length * right.length > MAX_LCS_CELLS) return { added: right, removed: left };

  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i * width + j] =
        left[i] === right[j]
          ? (table[(i + 1) * width + j + 1] as number) + 1
          : Math.max(table[(i + 1) * width + j] as number, table[i * width + j + 1] as number);
    }
  }

  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] as number) >= (table[i * width + j + 1] as number)) {
      removed.push(left[i++] as string);
    } else {
      added.push(right[j++] as string);
    }
  }
  removed.push(...left.slice(i));
  added.push(...right.slice(j));
  return { added, removed };
}
