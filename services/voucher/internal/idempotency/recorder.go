package idempotency

import (
	"bytes"
	"net/http"
)

// recorder buffers a handler's response instead of writing it straight to
// the network, so runAndRecord can persist it to platform.idempotency and
// only afterwards release it to the real client.
type recorder struct {
	header      http.Header
	status      int
	body        bytes.Buffer
	wroteHeader bool
}

func newRecorder() *recorder {
	return &recorder{header: make(http.Header), status: http.StatusOK}
}

func (rec *recorder) Header() http.Header { return rec.header }

func (rec *recorder) WriteHeader(status int) {
	if rec.wroteHeader {
		return
	}
	rec.status = status
	rec.wroteHeader = true
}

func (rec *recorder) Write(b []byte) (int, error) {
	if !rec.wroteHeader {
		rec.WriteHeader(http.StatusOK)
	}
	return rec.body.Write(b)
}

// flush releases the buffered response to the real client.
func (rec *recorder) flush(w http.ResponseWriter) {
	for name, values := range rec.header {
		for _, value := range values {
			w.Header().Add(name, value)
		}
	}
	w.WriteHeader(rec.status)
	_, _ = w.Write(rec.body.Bytes())
}
