// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Package textdiff writes a unified diff of two texts, line by line, as diff
// -u and git diff do. It exists so an MCP preview can return what an edit
// changes instead of the whole file, without a diff dependency: the edit
// script is Myers' O((N+M)D) algorithm, which is fast while the change is
// small, and a preview's change is.
package textdiff

import (
	"fmt"
	"strings"
)

// noNewline marks a last line that has no newline, as diff and git do.
const noNewline = "\\ No newline at end of file\n"

// Unified returns the unified diff that turns oldText into newText, under
// the headers "--- oldName" and "+++ newName" ("/dev/null" names a file
// that does not exist), with context unchanged lines around each change.
// Changes no more than 2*context lines apart share a hunk. Equal texts give
// "". The result is deterministic: the same texts always give the same diff.
func Unified(oldName, newName, oldText, newText string, context int) string {
	if oldText == newText {
		return ""
	}
	if context < 0 {
		context = 0
	}
	script := editScript(splitLines(oldText), splitLines(newText))
	var b strings.Builder
	fmt.Fprintf(&b, "--- %s\n+++ %s\n", oldName, newName)
	for _, h := range hunks(script, context) {
		writeHunk(&b, script[h.from:h.to])
	}
	return b.String()
}

// splitLines splits s after each newline; a last line without one is kept.
func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	ls := strings.SplitAfter(s, "\n")
	if ls[len(ls)-1] == "" {
		ls = ls[:len(ls)-1]
	}
	return ls
}

// step is one line of the edit script: kept (' '), removed ('-') or added
// ('+'), with the 0-based line numbers it has in the old and new texts
// before it.
type step struct {
	kind     byte
	line     string
	old, new int
}

// editScript returns a shortest edit script from a to b (Myers 1986): it
// records the furthest-reaching path for each number of edits d, then walks
// those records back from the end.
func editScript(a, b []string) []step {
	n, m := len(a), len(b)
	limit := n + m
	offset := limit + 1
	v := make([]int, 2*limit+3)
	var trace [][]int
	for d := 0; d <= limit; d++ {
		trace = append(trace, append([]int(nil), v...))
		done := false
		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
				x = v[offset+k+1] // down: an insertion
			} else {
				x = v[offset+k-1] + 1 // right: a deletion
			}
			y := x - k
			for x < n && y < m && a[x] == b[y] {
				x++
				y++
			}
			v[offset+k] = x
			if x >= n && y >= m {
				done = true
				break
			}
		}
		if done {
			break
		}
	}

	var script []step
	x, y := n, m
	for d := len(trace) - 1; d >= 0; d-- {
		v := trace[d]
		k := x - y
		var prevK int
		if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
			prevK = k + 1
		} else {
			prevK = k - 1
		}
		prevX := v[offset+prevK]
		prevY := prevX - prevK
		for x > prevX && y > prevY {
			x--
			y--
			script = append(script, step{' ', a[x], x, y})
		}
		if d > 0 {
			if x == prevX {
				y--
				script = append(script, step{'+', b[y], x, y})
			} else {
				x--
				script = append(script, step{'-', a[x], x, y})
			}
		}
		x, y = prevX, prevY
	}
	for i, j := 0, len(script)-1; i < j; i, j = i+1, j-1 {
		script[i], script[j] = script[j], script[i]
	}
	return script
}

// span is a hunk: script[from:to].
type span struct{ from, to int }

// hunks groups the changed steps with context kept steps on each side,
// merging groups whose gap is at most 2*context kept steps.
func hunks(script []step, context int) []span {
	var out []span
	for i := 0; i < len(script); {
		if script[i].kind == ' ' {
			i++
			continue
		}
		from := max(i-context, 0)
		end := i // the last changed step in this hunk
		for j := i + 1; j < len(script); j++ {
			if script[j].kind == ' ' {
				continue
			}
			if j-end-1 > 2*context {
				break
			}
			end = j
		}
		// The next change is more than 2*context steps after end, so its
		// hunk starts after this one ends: hunks never overlap.
		out = append(out, span{from, min(end+1+context, len(script))})
		i = end + 1
	}
	return out
}

// writeHunk writes one hunk's header and lines.
func writeHunk(b *strings.Builder, steps []step) {
	var oldCount, newCount int
	for _, s := range steps {
		if s.kind != '+' {
			oldCount++
		}
		if s.kind != '-' {
			newCount++
		}
	}
	fmt.Fprintf(b, "@@ -%s +%s @@\n", hunkRange(steps[0].old, oldCount), hunkRange(steps[0].new, newCount))
	for _, s := range steps {
		b.WriteByte(s.kind)
		b.WriteString(s.line)
		if !strings.HasSuffix(s.line, "\n") {
			b.WriteString("\n" + noNewline)
		}
	}
}

// hunkRange formats a range as diff -u does: "start,count" with 1-based
// start, "start" alone for one line, and for an empty range the line before
// it (0 at the top).
func hunkRange(start, count int) string {
	switch count {
	case 0:
		return fmt.Sprintf("%d,0", start)
	case 1:
		return fmt.Sprintf("%d", start+1)
	default:
		return fmt.Sprintf("%d,%d", start+1, count)
	}
}
