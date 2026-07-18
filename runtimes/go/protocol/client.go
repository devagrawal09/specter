package protocol

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func (c *Client) Capabilities(ctx context.Context, request CapabilitiesRequest) (CapabilitiesResponse, error) {
	request.Envelope = prepare(request.Envelope, "capabilities.request")
	var response CapabilitiesResponse
	_, err := c.post(ctx, "/capabilities", request, &response, responseEnvelope(request.Envelope, "capabilities.response"))
	if err == nil && response.Error != nil {
		err = response.Error
	}
	return response, err
}
func (c *Client) Command(ctx context.Context, request CommandRequest) (CommandResponse, error) {
	request.Envelope = prepare(request.Envelope, "command.request")
	var response CommandResponse
	fields, err := c.post(ctx, "/commands", request, &response, responseEnvelope(request.Envelope, "command.response"))
	if fields != nil {
		if validationErr := validateCommandResponse(request, response, fields); validationErr != nil {
			err = validationErr
		}
	}
	if err == nil && response.Error != nil {
		err = response.Error
	}
	return response, err
}
func (c *Client) Query(ctx context.Context, request QueryRequest) (QueryResponse, error) {
	request.Envelope = prepare(request.Envelope, "query.request")
	var response QueryResponse
	fields, err := c.post(ctx, "/queries", request, &response, responseEnvelope(request.Envelope, "query.response"))
	if fields != nil {
		if validationErr := validateQueryResponse(request, response, fields); validationErr != nil {
			err = validationErr
		}
	}
	if err == nil && response.Error != nil {
		err = response.Error
	}
	return response, err
}
func (c *Client) SendObservations(ctx context.Context, batch RuntimeObservationBatch) (ObservationAcknowledgement, error) {
	batch.Envelope = prepare(batch.Envelope, "observations.batch")
	var response ObservationAcknowledgement
	_, err := c.post(ctx, "/observations", batch, &response, responseEnvelope(batch.Envelope, "observations.ack"))
	if err == nil && response.Error != nil {
		err = response.Error
	}
	if err == nil {
		err = validateObservationAcknowledgement(batch, response)
	}
	return response, err
}

func (c *Client) ReactionTicket(ctx context.Context, id, requestID string) (ReactionTicketResponse, error) {
	if requestID == "" {
		requestID = newRequestID()
	}
	endpoint := strings.TrimRight(c.BaseURL, "/") + "/reaction-tickets/" + url.PathEscape(id) + "?requestId=" + url.QueryEscape(requestID)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ReactionTicketResponse{}, err
	}
	response, err := c.httpClient().Do(request)
	if err != nil {
		return ReactionTicketResponse{}, err
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return ReactionTicketResponse{}, err
	}
	var result ReactionTicketResponse
	if err := json.Unmarshal(contents, &result); err != nil {
		return result, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(contents, &fields); err != nil {
		return result, err
	}
	expected := Envelope{ProtocolVersion: Version, Kind: "reaction-ticket.response", RequestID: requestID}
	if result.Envelope != expected || result.ReactionTicketID != id {
		return result, fmt.Errorf("specter protocol: response envelope does not match request")
	}
	if err := validateReactionTicketResponse(result, fields); err != nil {
		return result, err
	}
	if result.Error != nil {
		return result, result.Error
	}
	if response.StatusCode >= 300 {
		return result, fmt.Errorf("specter protocol: HTTP %s", response.Status)
	}
	return result, nil
}

func (c *Client) Subscribe(ctx context.Context, request SubscriptionRequest) (<-chan SubscriptionMessage, <-chan error, error) {
	request.Envelope = prepare(request.Envelope, "subscription.request")
	body, err := json.Marshal(request)
	if err != nil {
		return nil, nil, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+"/subscriptions", bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "text/event-stream")
	response, err := c.httpClient().Do(httpRequest)
	if err != nil {
		return nil, nil, err
	}
	if response.StatusCode >= 300 {
		defer response.Body.Close()
		contents, readErr := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		if readErr == nil {
			var message SubscriptionMessage
			var fields map[string]json.RawMessage
			if json.Unmarshal(contents, &message) == nil && json.Unmarshal(contents, &fields) == nil && message.Kind == "subscription.error" && validateSubscriptionMessage(request, message, fields) == nil {
				return nil, nil, message.Error
			}
		}
		return nil, nil, &specter.Error{Code: specter.ErrTransportFailure, Message: "Subscription transport failed."}
	}
	messages := make(chan SubscriptionMessage, 1)
	failures := make(chan error, 1)
	go func() {
		defer response.Body.Close()
		defer close(messages)
		defer close(failures)
		scanner := bufio.NewScanner(response.Body)
		scanner.Buffer(make([]byte, 4096), 1<<20)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			payload := []byte(strings.TrimPrefix(line, "data: "))
			var message SubscriptionMessage
			if err := json.Unmarshal(payload, &message); err != nil {
				failures <- err
				return
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(payload, &fields); err != nil {
				failures <- err
				return
			}
			if err := validateSubscriptionMessage(request, message, fields); err != nil {
				failures <- err
				return
			}
			select {
			case messages <- message:
			default:
				select {
				case <-messages:
				default:
				}
				select {
				case messages <- message:
				case <-ctx.Done():
					return
				}
			}
			if message.Kind == "subscription.error" || message.Kind == "subscription.complete" {
				return
			}
		}
		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			failures <- err
		} else if ctx.Err() == nil {
			failures <- fmt.Errorf("specter protocol: subscription stream ended before a terminal message: %w", io.ErrUnexpectedEOF)
		}
	}()
	return messages, failures, nil
}

func (c *Client) post(ctx context.Context, path string, input, output any, expected Envelope) (map[string]json.RawMessage, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	contents, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(contents, output); err != nil {
		return nil, fmt.Errorf("specter protocol: malformed JSON response: %w", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(contents, &fields); err != nil {
		return nil, fmt.Errorf("specter protocol: malformed JSON response: %w", err)
	}
	actual, ok := responseEnvelopeOf(output)
	if !ok || actual.ProtocolVersion != expected.ProtocolVersion || actual.Kind != expected.Kind || actual.RequestID != expected.RequestID {
		return fields, fmt.Errorf("specter protocol: response envelope does not match request")
	}
	if response.StatusCode >= 300 {
		if failure := responseErrorOf(output); failure != nil {
			return fields, failure
		}
		return fields, fmt.Errorf("specter protocol: HTTP %s", response.Status)
	}
	return fields, nil
}

func responseEnvelopeOf(response any) (Envelope, bool) {
	switch value := response.(type) {
	case *CapabilitiesResponse:
		return value.Envelope, true
	case *CommandResponse:
		return value.Envelope, true
	case *QueryResponse:
		return value.Envelope, true
	case *ObservationAcknowledgement:
		return value.Envelope, true
	default:
		return Envelope{}, false
	}
}

func responseErrorOf(response any) *specter.Error {
	switch value := response.(type) {
	case *CapabilitiesResponse:
		return value.Error
	case *CommandResponse:
		return value.Error
	case *QueryResponse:
		return value.Error
	case *ObservationAcknowledgement:
		return value.Error
	default:
		return nil
	}
}

func validateCommandResponse(request CommandRequest, response CommandResponse, fields map[string]json.RawMessage) error {
	if !hasFields(fields, "operationId", "status", "version", "events") || response.OperationID == "" || response.OperationID != request.OperationID {
		return fmt.Errorf("specter protocol: Command response does not match request or omits required fields")
	}
	if !rawInteger(fields, "version", true) || !safeInteger(response.Version) || !rawArray(fields["events"]) {
		return fmt.Errorf("specter protocol: Command response version and events are invalid")
	}
	_, hasError := fields["error"]
	_, hasTicket := fields["reactionTicketId"]
	switch response.Status {
	case "committed", "duplicate":
		if hasError || response.Error != nil || !hasTicket || response.ReactionTicketID == "" {
			return fmt.Errorf("specter protocol: successful Command response must contain a nonempty Reaction ticket and no error")
		}
	case "rejected":
		if !hasError || response.Error == nil || response.Error.Code == "" || response.Error.Message == "" {
			return fmt.Errorf("specter protocol: rejected Command response must contain an error")
		}
		if len(response.Events) > 0 || hasTicket || response.ReactionTicketID != "" {
			return fmt.Errorf("specter protocol: rejected Command response must not contain committed work")
		}
	default:
		return fmt.Errorf("specter protocol: unknown Command response status %q", response.Status)
	}
	return nil
}

func validateQueryResponse(request QueryRequest, response QueryResponse, fields map[string]json.RawMessage) error {
	if !hasFields(fields, "operationId") || response.OperationID == "" || response.OperationID != request.OperationID {
		return fmt.Errorf("specter protocol: Query response does not match request or omits operationId")
	}
	_, hasResult := fields["result"]
	_, hasError := fields["error"]
	if response.Error != nil {
		if !hasError || hasResult || response.Error.Code == "" || response.Error.Message == "" {
			return fmt.Errorf("specter protocol: failed Query response must contain only an error")
		}
		return nil
	}
	if hasError || !hasResult {
		return fmt.Errorf("specter protocol: successful Query response must contain only a result")
	}
	return nil
}

func hasFields(fields map[string]json.RawMessage, names ...string) bool {
	for _, name := range names {
		if _, present := fields[name]; !present {
			return false
		}
	}
	return true
}

func validateSubscriptionMessage(request SubscriptionRequest, message SubscriptionMessage, fields map[string]json.RawMessage) error {
	if message.ProtocolVersion != Version || message.RequestID != request.RequestID || message.OperationID == "" || message.OperationID != request.OperationID || !hasFields(fields, "operationId") {
		return fmt.Errorf("specter protocol: subscription message does not match request")
	}
	_, hasResult := fields["result"]
	_, hasError := fields["error"]
	_, hasSequence := fields["sequence"]
	switch message.Kind {
	case "subscription.value":
		if hasError || message.Error != nil || !hasResult || !hasSequence || !rawInteger(fields, "sequence", true) || !safeInteger(message.Sequence) {
			return fmt.Errorf("specter protocol: subscription value must contain only a result")
		}
	case "subscription.error":
		if !hasError || message.Error == nil || message.Error.Code == "" || message.Error.Message == "" || hasResult || hasSequence {
			return fmt.Errorf("specter protocol: subscription error must contain only an error")
		}
	case "subscription.complete":
		if hasError || message.Error != nil || hasResult || hasSequence {
			return fmt.Errorf("specter protocol: subscription completion must not contain a result or error")
		}
	default:
		return fmt.Errorf("specter protocol: unknown subscription message kind %q", message.Kind)
	}
	return nil
}

func validateReactionTicketResponse(response ReactionTicketResponse, fields map[string]json.RawMessage) error {
	_, hasError := fields["error"]
	switch response.Status {
	case "pending", "completed":
		if hasError || response.Error != nil {
			return fmt.Errorf("specter protocol: successful Reaction ticket response must not contain an error")
		}
	case "failed":
		if !hasError || response.Error == nil || response.Error.Code == "" || response.Error.Message == "" {
			return fmt.Errorf("specter protocol: failed Reaction ticket response must contain an error")
		}
	default:
		return fmt.Errorf("specter protocol: unknown Reaction ticket response status %q", response.Status)
	}
	return nil
}

func validateObservationAcknowledgement(batch RuntimeObservationBatch, acknowledgement ObservationAcknowledgement) error {
	if acknowledgement.Accepted < 0 || acknowledgement.Duplicates < 0 {
		return fmt.Errorf("specter protocol: observation acknowledgement counts must be non-negative")
	}
	observationIDs := make(map[string]struct{}, len(batch.Observations))
	for _, observation := range batch.Observations {
		observationIDs[observation.ObservationID] = struct{}{}
	}
	rejected := make(map[string]struct{}, len(acknowledgement.RejectedObservationIDs))
	for _, id := range acknowledgement.RejectedObservationIDs {
		if _, exists := observationIDs[id]; !exists {
			return fmt.Errorf("specter protocol: acknowledgement rejected an observation outside the batch")
		}
		if _, duplicate := rejected[id]; duplicate {
			return fmt.Errorf("specter protocol: acknowledgement contains duplicate rejected observation IDs")
		}
		rejected[id] = struct{}{}
	}
	accounted := acknowledgement.Accepted + acknowledgement.Duplicates + len(rejected)
	if accounted != len(batch.Observations) {
		return fmt.Errorf("specter protocol: acknowledgement accounts for %d of %d observations", accounted, len(batch.Observations))
	}
	return nil
}
func prepare(envelope Envelope, kind string) Envelope {
	envelope.ProtocolVersion = Version
	envelope.Kind = kind
	if envelope.RequestID == "" {
		envelope.RequestID = newRequestID()
	}
	return envelope
}
