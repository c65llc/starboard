// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package lint

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteRulesJSON(t *testing.T) {
	var b bytes.Buffer
	require.NoError(t, WriteRulesJSON(&b))
	assert.True(t, bytes.HasPrefix(b.Bytes(), []byte("{\n  \"version\": 1,\n  \"rules\": [\n")))
	assert.True(t, bytes.HasSuffix(b.Bytes(), []byte("}\n")))
	var got rulesReport
	require.NoError(t, json.Unmarshal(b.Bytes(), &got))
	assert.Equal(t, report(), got)
	require.Len(t, got.Rules, len(Rules()))
	for i, r := range Rules() {
		assert.Equal(t, ruleEntry{ID: r.ID, Kind: r.Kind(), Default: r.Default, Summary: r.Summary, Docs: r.Docs()}, got.Rules[i])
	}
}
