package settings_test

import (
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/settings"
)

// F127: a receipt_funder value is read strictly, as the contract writes it.
func TestAReceiptFunderIsParsedStrictly(t *testing.T) {
	const id = "00000000-0000-4000-8000-000000000001"
	for _, raw := range []string{`{"businessId":"` + id + `"}`, `{ "businessId": "` + id + `" }`} {
		if got, err := settings.ParseReceiptFunder([]byte(raw)); err != nil || got != id {
			t.Errorf("%s = %q (%v)", raw, got, err)
		}
	}
	for name, raw := range map[string]string{
		"upper case":    `{"businessId":"00000000-0000-4000-8000-00000000000A"}`,
		"not a uuid":    `{"businessId":"snap-app"}`,
		"no business":   `{}`,
		"null":          `{"businessId":null}`,
		"another field": `{"businessId":"` + id + `","partnerId":"snap-app"}`,
		"a bare string": `"` + id + `"`,
		"trailing data": `{"businessId":"` + id + `"} {}`,
	} {
		if _, err := settings.ParseReceiptFunder([]byte(raw)); !errors.Is(err, settings.ErrReceiptFunderValue) {
			t.Errorf("%s: err = %v, want ErrReceiptFunderValue", name, err)
		}
	}
}
