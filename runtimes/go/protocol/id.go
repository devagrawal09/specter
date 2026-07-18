package protocol

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync/atomic"
)

var requestCounter atomic.Uint64

func newRequestID() string {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err == nil {
		return "req_" + hex.EncodeToString(value)
	}
	return fmt.Sprintf("req_%d", requestCounter.Add(1))
}
