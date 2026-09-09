package bancoz

import (
	"fmt"
	"math/rand"
	"time"
)

// CriarID generates a unique ID in format {unix_ms_timestamp}-{random_chars}.
// Optional args: chars (string, default charset), length (int, default random 12-32).
// Equivalent to Node.js `bancoz.criarID(chars, length)`.
func (b *Bancoz) CriarID(args ...any) string {
	chars := "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	length := 0

	if len(args) > 0 {
		if c, ok := args[0].(string); ok && c != "auto" && c != "" {
			chars = c
		}
	}
	if len(args) > 1 {
		if l, ok := args[1].(int); ok && l > 0 {
			length = l
		}
	}

	if length <= 0 {
		// Random length between 12 and 32 inclusive (21 possible values)
		length = 12 + rand.Intn(21)
	}

	id := make([]byte, length)
	for i := 0; i < length; i++ {
		id[i] = chars[rand.Intn(len(chars))]
	}

	return fmt.Sprintf("%d-%s", time.Now().UnixMilli(), string(id))
}

// CreateID is an English alias for CriarID.
func (b *Bancoz) CreateID(args ...any) string {
	return b.CriarID(args...)
}
