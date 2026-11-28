// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package textdiff

import (
	"fmt"
	"math/rand/v2"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func lines(n int) string {
	var b strings.Builder
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, "line %d\n", i)
	}
	return b.String()
}

func TestUnifiedEqualIsEmpty(t *testing.T) {
	assert.Empty(t, Unified("a/x", "b/x", lines(5), lines(5), 3))
	assert.Empty(t, Unified("a/x", "b/x", "", "", 3))
}

func TestUnifiedInsertion(t *testing.T) {
	old := lines(10)
	next := strings.Replace(old, "line 5\n", "line 5\nnew\n", 1)
	want := "--- a/x\n+++ b/x\n@@ -3,6 +3,7 @@\n line 3\n line 4\n line 5\n+new\n line 6\n line 7\n line 8\n"
	assert.Equal(t, want, Unified("a/x", "b/x", old, next, 3))
}

func TestUnifiedReplacementAndDeletion(t *testing.T) {
	old := lines(6)
	next := strings.Replace(strings.Replace(old, "line 2\n", "two\n", 1), "line 5\n", "", 1)
	want := "--- a/x\n+++ b/x\n@@ -1,6 +1,5 @@\n line 1\n-line 2\n+two\n line 3\n line 4\n-line 5\n line 6\n"
	assert.Equal(t, want, Unified("a/x", "b/x", old, next, 3))
}

// Changes further apart than twice the context are separate hunks; closer
// ones share one.
func TestUnifiedHunks(t *testing.T) {
	old := lines(30)
	far := strings.Replace(strings.Replace(old, "line 3\n", "three\n", 1), "line 25\n", "twenty-five\n", 1)
	got := Unified("a/x", "b/x", old, far, 3)
	assert.Equal(t, 2, strings.Count(got, "\n@@ "), got)
	assert.Contains(t, got, "@@ -1,6 +1,6 @@\n")
	assert.Contains(t, got, "@@ -22,7 +22,7 @@\n")

	near := strings.Replace(strings.Replace(old, "line 3\n", "three\n", 1), "line 8\n", "eight\n", 1)
	assert.Equal(t, 1, strings.Count(Unified("a/x", "b/x", old, near, 3), "\n@@ "))
}

// A new file is diffed from /dev/null, and a one-line range omits its count.
func TestUnifiedNewAndEmptied(t *testing.T) {
	assert.Equal(t, "--- /dev/null\n+++ b/x\n@@ -0,0 +1,2 @@\n+a\n+b\n", Unified("/dev/null", "b/x", "", "a\nb\n", 3))
	assert.Equal(t, "--- a/x\n+++ b/x\n@@ -1 +0,0 @@\n-a\n", Unified("a/x", "b/x", "a\n", "", 3))
	assert.Equal(t, "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n", Unified("a/x", "b/x", "a\n", "b\n", 3))
}

// A last line without a newline is marked, as diff and git mark it.
func TestUnifiedNoFinalNewline(t *testing.T) {
	want := "--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n"
	assert.Equal(t, want, Unified("a/x", "b/x", "a\nb", "a\nb\n", 3))
}

// Applying the diff to the old text gives the new text, for random edits.
func TestUnifiedRoundTrip(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2)) //nolint:gosec // G404: a seeded generator makes the random cases repeatable; nothing here is secret
	for i := range 500 {
		old := randomText(r)
		next := mutate(r, old)
		d := Unified("a/x", "b/x", old, next, r.IntN(4))
		if old == next {
			assert.Empty(t, d)
			continue
		}
		got, err := apply(old, d)
		require.NoError(t, err, "case %d:\n%s", i, d)
		require.Equal(t, next, got, "case %d:\n%s", i, d)
	}
}

func randomText(r *rand.Rand) string {
	var b strings.Builder
	for range r.IntN(25) {
		b.WriteString(strconv.Itoa(r.IntN(6)))
		b.WriteByte('\n')
	}
	s := b.String()
	if s != "" && r.IntN(5) == 0 {
		s = strings.TrimSuffix(s, "\n")
	}
	return s
}

func mutate(r *rand.Rand, s string) string {
	ls := strings.SplitAfter(s, "\n")
	if ls[len(ls)-1] == "" {
		ls = ls[:len(ls)-1]
	}
	for range r.IntN(5) {
		switch at := r.IntN(len(ls) + 1); r.IntN(3) {
		case 0:
			ls = append(ls[:at], append([]string{strconv.Itoa(r.IntN(9)) + "\n"}, ls[at:]...)...)
		case 1:
			if at < len(ls) {
				ls = append(ls[:at], ls[at+1:]...)
			}
		default:
			if at < len(ls) {
				ls[at] = "x" + ls[at]
			}
		}
	}
	return strings.Join(ls, "")
}

var hunkHeader = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@\n$`)

// apply is a minimal patch, enough to check every hunk against the old
// text: context and removed lines must match it, at the line the header
// names.
func apply(old, diff string) (string, error) {
	src := splitLines(old)
	dl := splitLines(diff)
	if len(dl) < 3 || !strings.HasPrefix(dl[0], "--- ") || !strings.HasPrefix(dl[1], "+++ ") {
		return "", fmt.Errorf("missing --- / +++ header")
	}
	var out []string
	pos := 0
	for i := 2; i < len(dl); {
		m := hunkHeader.FindStringSubmatch(dl[i])
		if m == nil {
			return "", fmt.Errorf("bad hunk header %q", dl[i])
		}
		start, _ := strconv.Atoi(m[1])
		if m[2] != "0" { // a range of n>0 lines starts AT line start; an empty one AFTER it
			start--
		}
		if start < pos {
			return "", fmt.Errorf("hunk at %d overlaps the one before", start+1)
		}
		out = append(out, src[pos:start]...)
		pos = start
		for i++; i < len(dl) && !strings.HasPrefix(dl[i], "@@"); i++ {
			line := dl[i]
			if strings.HasPrefix(line, `\`) { // the line before has no newline
				if prev := dl[i-1]; prev[0] != '-' {
					out[len(out)-1] = strings.TrimSuffix(out[len(out)-1], "\n")
				}
				continue
			}
			body := line[1:]
			switch line[0] {
			case ' ', '-':
				if pos >= len(src) || strings.TrimSuffix(src[pos], "\n") != strings.TrimSuffix(body, "\n") {
					return "", fmt.Errorf("old line %d does not match %q", pos+1, line)
				}
				if line[0] == ' ' {
					out = append(out, src[pos])
				}
				pos++
			case '+':
				out = append(out, body)
			default:
				return "", fmt.Errorf("bad diff line %q", line)
			}
		}
	}
	out = append(out, src[pos:]...)
	return strings.Join(out, ""), nil
}

// A negative context is no context.
func TestUnifiedNegativeContext(t *testing.T) {
	old := lines(5)
	next := strings.Replace(old, "line 3\n", "three\n", 1)
	assert.Equal(t, Unified("a/x", "b/x", old, next, 0), Unified("a/x", "b/x", old, next, -2))
	assert.Equal(t, "--- a/x\n+++ b/x\n@@ -3 +3 @@\n-line 3\n+three\n", Unified("a/x", "b/x", old, next, -2))
}
