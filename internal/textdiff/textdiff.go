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

// maxEdits bounds the Myers search. Its trace holds about d² integers for
// d edits, so 1024 edits cost about 8 MB; a change larger than that is
// written as its middle removed and replaced, a correct diff if not the
// shortest one.
const maxEdits = 1024

// editScript returns an edit script from a to b. The lines a and b share
// at the start and the end are kept without a search, which makes a new
// file, an emptied one and an edit in one place cost no more than their
// size; the rest is a shortest script (Myers) unless that needs more than
// maxEdits edits, when it is replaced whole.
func editScript(a, b []string) []step {
	pre := 0
	for pre < len(a) && pre < len(b) && a[pre] == b[pre] {
		pre++
	}
	suf := 0
	for suf < len(a)-pre && suf < len(b)-pre && a[len(a)-1-suf] == b[len(b)-1-suf] {
		suf++
	}
	script := make([]step, 0, len(a)+len(b)-pre-suf)
	for i := range pre {
		script = append(script, step{' ', a[i], i, i})
	}
	midA, midB := a[pre:len(a)-suf], b[pre:len(b)-suf]
	mid, ok := myers(midA, midB, pre, maxEdits)
	if !ok {
		mid = replaceWhole(midA, midB, pre)
	}
	script = append(script, mid...)
	for i := range suf {
		oi, ni := len(a)-suf+i, len(b)-suf+i
		script = append(script, step{' ', a[oi], oi, ni})
	}
	return script
}

// replaceWhole is the script that removes all of a and adds all of b, both
// starting at line at.
func replaceWhole(a, b []string, at int) []step {
	script := make([]step, 0, len(a)+len(b))
	for i, line := range a {
		script = append(script, step{'-', line, at + i, at})
	}
	for j, line := range b {
		script = append(script, step{'+', line, at + len(a), at + j})
	}
	return script
}

// myers returns a shortest edit script from a to b (Myers 1986), with line
// numbers offset by at, or false when it needs more than limit edits. It
// records the furthest-reaching path on each diagonal for each number of
// edits d, keeping only the diagonals d can reach, then walks the records
// back from the end.
func myers(a, b []string, at, limit int) ([]step, bool) {
	n, m := len(a), len(b)
	if n == 0 || m == 0 { // nothing to search: all removals, or all additions
		return replaceWhole(a, b, at), true
	}
	maxD := min(n+m, limit)
	offset := maxD + 1
	v := make([]int, 2*maxD+3)
	// trace[d] is v, before step d, on diagonals -d-1 .. d+1: what walking
	// back through step d reads.
	var trace [][]int
	found := false
	for d := 0; d <= maxD && !found; d++ {
		trace = append(trace, append([]int(nil), v[offset-d-1:offset+d+2]...))
		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
				x = v[offset+k+1] // down: an addition
			} else {
				x = v[offset+k-1] + 1 // right: a removal
			}
			y := x - k
			for x < n && y < m && a[x] == b[y] {
				x++
				y++
			}
			v[offset+k] = x
			if x >= n && y >= m {
				found = true
				break
			}
		}
	}
	if !found {
		return nil, false
	}

	var script []step
	x, y := n, m
	for d := len(trace) - 1; d >= 0; d-- {
		saved := trace[d]
		at := func(k int) int { return saved[k+d+1] }
		k := x - y
		var prevK int
		if k == -d || (k != d && at(k-1) < at(k+1)) {
			prevK = k + 1
		} else {
			prevK = k - 1
		}
		prevX := at(prevK)
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
	for i := range script {
		script[i].old += at
		script[i].new += at
	}
	return script, true
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
