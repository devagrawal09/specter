package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// ObservationClient sends runtime metadata and portable specifications to a
// Specter collector. It cannot execute application Commands or Queries.
type ObservationClient struct {
	CollectorURL string
	HTTPClient   *http.Client
}

func (client *ObservationClient) httpClient() *http.Client {
	if client.HTTPClient != nil {
		return client.HTTPClient
	}
	return http.DefaultClient
}

func (client *ObservationClient) SendObservations(ctx context.Context, batch RuntimeObservationBatch) (ObservationAcknowledgement, error) {
	batch.Envelope = prepare(batch.Envelope, "observations.batch")
	if err := ValidateObservationBatch(batch); err != nil {
		return ObservationAcknowledgement{}, err
	}
	body, err := json.Marshal(batch)
	if err != nil {
		return ObservationAcknowledgement{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(client.CollectorURL, "/")+"/specter/v1/observations", bytes.NewReader(body))
	if err != nil {
		return ObservationAcknowledgement{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := client.httpClient().Do(request)
	if err != nil {
		return ObservationAcknowledgement{}, err
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return ObservationAcknowledgement{}, err
	}
	if err := ValidateMessageJSON(contents); err != nil {
		return ObservationAcknowledgement{}, err
	}
	var acknowledgement ObservationAcknowledgement
	if err := json.Unmarshal(contents, &acknowledgement); err != nil {
		return acknowledgement, fmt.Errorf("specter protocol: malformed JSON response: %w", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(contents, &fields); err != nil {
		return acknowledgement, fmt.Errorf("specter protocol: malformed JSON response: %w", err)
	}
	expected := Envelope{ProtocolVersion: Version, Kind: "observations.ack", RequestID: batch.RequestID}
	if acknowledgement.Envelope != expected {
		return acknowledgement, fmt.Errorf("specter protocol: acknowledgement envelope does not match batch")
	}
	if response.StatusCode >= 300 {
		return acknowledgement, fmt.Errorf("specter protocol: HTTP %s", response.Status)
	}
	if err := validateObservationAcknowledgement(batch, acknowledgement, fields); err != nil {
		return acknowledgement, err
	}
	return acknowledgement, nil
}

func (client *ObservationClient) SendSpecifications(ctx context.Context, publication SpecificationPublication) (SpecificationAcknowledgement, error) {
	publication.Envelope = prepare(publication.Envelope, "specifications.publish")
	body, err := json.Marshal(publication)
	if err != nil {
		return SpecificationAcknowledgement{}, err
	}
	if err := ValidateMessageJSON(body); err != nil {
		return SpecificationAcknowledgement{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(client.CollectorURL, "/")+"/specter/v1/specifications", bytes.NewReader(body))
	if err != nil {
		return SpecificationAcknowledgement{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := client.httpClient().Do(request)
	if err != nil {
		return SpecificationAcknowledgement{}, err
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return SpecificationAcknowledgement{}, err
	}
	if err := ValidateMessageJSON(contents); err != nil {
		return SpecificationAcknowledgement{}, err
	}
	var acknowledgement SpecificationAcknowledgement
	if err := json.Unmarshal(contents, &acknowledgement); err != nil {
		return acknowledgement, fmt.Errorf("specter protocol: malformed JSON response: %w", err)
	}
	expected := Envelope{ProtocolVersion: Version, Kind: "specifications.ack", RequestID: publication.RequestID}
	if acknowledgement.Envelope != expected {
		return acknowledgement, fmt.Errorf("specter protocol: acknowledgement envelope does not match publication")
	}
	if response.StatusCode >= 300 {
		return acknowledgement, fmt.Errorf("specter protocol: HTTP %s", response.Status)
	}
	published := make(map[string]struct{}, len(publication.Specifications))
	for _, item := range publication.Specifications {
		published[item.Digest] = struct{}{}
	}
	acknowledged := append(append([]string(nil), acknowledgement.AcceptedDigests...), acknowledgement.RejectedDigests...)
	seen := make(map[string]struct{}, len(acknowledged))
	for _, digest := range acknowledged {
		if _, exists := published[digest]; !exists {
			return acknowledgement, fmt.Errorf("specter protocol: acknowledgement contains an unknown specification digest")
		}
		if _, duplicate := seen[digest]; duplicate {
			return acknowledgement, fmt.Errorf("specter protocol: acknowledgement contains a duplicate specification digest")
		}
		seen[digest] = struct{}{}
	}
	return acknowledgement, nil
}

func prepare(envelope Envelope, kind string) Envelope {
	envelope.ProtocolVersion = Version
	envelope.Kind = kind
	if envelope.RequestID == "" {
		envelope.RequestID = newRequestID()
	}
	return envelope
}
