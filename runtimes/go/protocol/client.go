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
	err := c.post(ctx, "/capabilities", request, &response)
	if err == nil && response.Error != nil {
		err = response.Error
	}
	return response, err
}
func (c *Client) Command(ctx context.Context, request CommandRequest) (CommandResponse, error) {
	request.Envelope = prepare(request.Envelope, "command.request")
	var response CommandResponse
	err := c.post(ctx, "/commands", request, &response)
	if err == nil && response.Error != nil {
		err = response.Error
	}
	return response, err
}
func (c *Client) Query(ctx context.Context, request QueryRequest) (QueryResponse, error) {
	request.Envelope = prepare(request.Envelope, "query.request")
	var response QueryResponse
	err := c.post(ctx, "/queries", request, &response)
	if err == nil && response.Error != nil {
		err = response.Error
	}
	return response, err
}
func (c *Client) SendObservations(ctx context.Context, batch RuntimeObservationBatch) (ObservationAcknowledgement, error) {
	batch.Envelope = prepare(batch.Envelope, "observations.batch")
	var response ObservationAcknowledgement
	err := c.post(ctx, "/observations", batch, &response)
	if err == nil && response.Error != nil {
		err = response.Error
	}
	return response, err
}

func (c *Client) ReactionTicket(ctx context.Context, id, requestID string) (ReactionTicketResponse, error) {
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
	var result ReactionTicketResponse
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
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
		contents, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		return nil, nil, fmt.Errorf("specter protocol: HTTP %s: %s", response.Status, contents)
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
			var message SubscriptionMessage
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &message); err != nil {
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
		}
		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			failures <- err
		}
	}()
	return messages, failures, nil
}

func (c *Client) post(ctx context.Context, path string, input, output any) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient().Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(output); err != nil {
		return err
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
