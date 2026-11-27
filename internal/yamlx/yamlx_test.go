// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package yamlx

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"

	"github.com/c65llc/starboard/internal/diag"
)

func TestDecodeMapping(t *testing.T) {
	n, ds := Decode([]byte("a: 1\n"), "x.yaml")
	require.Empty(t, ds)
	require.NotNil(t, n)
	assert.Equal(t, yaml.MappingNode, n.Kind)
}

func TestDecodeEmpty(t *testing.T) {
	for _, src := range []string{"", "# only a comment\n"} {
		n, ds := Decode([]byte(src), "x.yaml")
		require.Empty(t, ds)
		require.NotNil(t, n)
		assert.True(t, IsNull(n))
	}
}

func TestDecodeDocument(t *testing.T) {
	doc, ds := DecodeDocument([]byte("# head\n\na: 1\n# foot\n"), "x.yaml")
	require.Empty(t, ds)
	require.NotNil(t, doc)
	assert.Equal(t, yaml.DocumentNode, doc.Kind)
	assert.Equal(t, "# head", doc.HeadComment)
	require.Len(t, doc.Content, 1)
	assert.Equal(t, yaml.MappingNode, doc.Content[0].Kind)

	doc, ds = DecodeDocument([]byte(""), "x.yaml")
	require.Empty(t, ds)
	require.NotNil(t, doc)
	assert.Empty(t, doc.Content)

	doc, ds = DecodeDocument([]byte("a: &x 1\n"), "x.yaml")
	assert.Nil(t, doc)
	require.Len(t, ds, 1)
	assert.Equal(t, "yaml-alias-not-allowed", ds[0].Rule)
}

func TestDecodeSyntaxError(t *testing.T) {
	n, ds := Decode([]byte("a: [\n"), "x.yaml")
	assert.Nil(t, n)
	require.Len(t, ds, 1)
	assert.Equal(t, "yaml-syntax", ds[0].Rule)
	assert.Equal(t, diag.Error, ds[0].Severity)
	assert.Equal(t, "x.yaml", ds[0].File)
	assert.Equal(t, 1, ds[0].Line)
	assert.Equal(t, "did not find expected node content", ds[0].Message, "the line is the diagnostic's, not the message's")

	_, ds = Decode([]byte("a: \x01\n"), "x.yaml")
	require.Len(t, ds, 1)
	assert.Equal(t, "control characters are not allowed", ds[0].Message)
}

func TestDecodeMultipleDocuments(t *testing.T) {
	for name, tc := range map[string]struct {
		src  string
		line int
	}{
		"second document":        {"a: 1\n---\nb: 2\n", 2},
		"empty second document":  {"a: 1\n---\n", 2},
		"syntax error in second": {"a: 1\n---\nb: [\n", 3},
	} {
		t.Run(name, func(t *testing.T) {
			n, ds := Decode([]byte(tc.src), "x.yaml")
			assert.Nil(t, n)
			require.Len(t, ds, 1)
			assert.Equal(t, "yaml-syntax", ds[0].Rule)
			assert.Equal(t, "x.yaml", ds[0].File)
			assert.Equal(t, tc.line, ds[0].Line)
		})
	}
	n, ds := Decode([]byte("a: 1\n...\n"), "x.yaml")
	require.Empty(t, ds, "a document end marker alone is not a second document")
	assert.NotNil(t, n)
}

func TestDecodeRejectsAliases(t *testing.T) {
	for name, src := range map[string]string{
		"anchor and alias": "a: &x [1]\nb: *x\n",
		"merge key":        "base: { w: 1 }\nbig:\n  <<: { w: 2 }\n",
	} {
		t.Run(name, func(t *testing.T) {
			n, ds := Decode([]byte(src), "x.yaml")
			assert.Nil(t, n)
			require.NotEmpty(t, ds)
			for _, d := range ds {
				assert.Equal(t, "yaml-alias-not-allowed", d.Rule)
				assert.Equal(t, "x.yaml", d.File)
				assert.Positive(t, d.Line)
			}
		})
	}
}

func TestDecodeAliasDiagnosticsAreSorted(t *testing.T) {
	_, ds := Decode([]byte("b: &x 1\na: *x\n"), "x.yaml")
	require.Len(t, ds, 2)
	assert.Equal(t, []int{1, 2}, []int{ds[0].Line, ds[1].Line})
}

func TestSyntaxLine(t *testing.T) {
	assert.Equal(t, 7, syntaxLine("yaml: line 7: did not find expected key"))
	assert.Equal(t, 0, syntaxLine("yaml: control characters are not allowed"))
}

func node(t *testing.T, src string) *yaml.Node {
	t.Helper()
	n, ds := Decode([]byte(src), "x.yaml")
	require.Empty(t, ds)
	return n
}

func newParser() *Parser { return &Parser{File: "x.yaml", Invalid: "schema-invalid"} }

func TestMapping(t *testing.T) {
	p := newParser()
	es, ok := p.Mapping(node(t, "a: 1\nb: 2\na: 3\nc: 4\n"), "top", map[string]bool{"a": true, "b": true})
	assert.True(t, ok)
	require.Len(t, es, 2)
	assert.Equal(t, "a", es[0].Key)
	assert.Equal(t, "top.a", es[0].Field)
	assert.Equal(t, "1", es[0].V.Value)
	assert.Equal(t, "b", es[1].Key)
	require.Len(t, p.Diags, 2)
	assert.Equal(t, diag.Diagnostic{Rule: "schema-invalid", Severity: diag.Error, File: "x.yaml", Path: "top.a", Line: 3, Message: "duplicate key a"}, p.Diags[0])
	assert.Equal(t, "unknown key c", p.Diags[1].Message)
	assert.Equal(t, "top.c", p.Diags[1].Path)
}

func TestMappingRootPathAndNull(t *testing.T) {
	p := newParser()
	es, ok := p.Mapping(node(t, "a: 1\n"), "", nil)
	assert.True(t, ok)
	assert.Equal(t, "a", es[0].Field)

	es, ok = p.Mapping(nil, "x", nil)
	assert.True(t, ok)
	assert.Nil(t, es)

	_, ok = p.Mapping(node(t, "[1]\n"), "", nil)
	assert.False(t, ok)
	_, ok = p.Mapping(node(t, "[1]\n"), "list", nil)
	assert.False(t, ok)
	require.Len(t, p.Diags, 2)
	assert.Equal(t, "x.yaml must be a mapping", p.Diags[0].Message)
	assert.Equal(t, "list must be a mapping", p.Diags[1].Message)
}

func TestStr(t *testing.T) {
	p := newParser()
	s, ok := p.Str(node(t, "hi\n"), "v")
	assert.True(t, ok)
	assert.Equal(t, "hi", s)
	_, ok = p.Str(node(t, "1\n"), "v")
	assert.False(t, ok)
	_, ok = p.Str(node(t, "\"\"\n"), "v")
	assert.False(t, ok)
	require.Len(t, p.Diags, 2)
	assert.Equal(t, "v must be a string", p.Diags[0].Message)
	assert.Equal(t, "v must not be empty", p.Diags[1].Message)
}

func TestStrList(t *testing.T) {
	p := newParser()
	items := p.StrList(node(t, "[a, 1, b]\n"), "l")
	assert.Equal(t, []string{"a", "b"}, Values(items))
	assert.Equal(t, "l[2]", items[1].Path)
	assert.Nil(t, p.StrList(nil, "l"))
	assert.Nil(t, p.StrList(node(t, "a\n"), "l"))
	require.Len(t, p.Diags, 2)
	assert.Equal(t, "l[1] must be a string", p.Diags[0].Message)
	assert.Equal(t, "l must be a list of strings", p.Diags[1].Message)
	assert.Nil(t, Values(nil))
}

func TestIsNull(t *testing.T) {
	assert.True(t, IsNull(nil))
	assert.True(t, IsNull(&yaml.Node{}))
	assert.True(t, IsNull(node(t, "~\n")))
	assert.False(t, IsNull(node(t, "a\n")))
}

func TestJoin(t *testing.T) {
	assert.Equal(t, "a", Join("", "a"))
	assert.Equal(t, "p.a", Join("p", "a"))
}
