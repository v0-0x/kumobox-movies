package providers

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ProviderError is why a provider gave nothing.
type ProviderError struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Message  string `json:"error"`
}

func (e ProviderError) Error() string { return e.Name + ": " + e.Message }

// Aggregate asks every provider that supports r.Type for streams, all at
// once, giving each one at most timeout (no limit when 0). It returns the
// streams in provider order (each provider's own order kept, duplicates
// and streams with nothing to play dropped, Provider/ProviderName filled
// in) and an error per provider that
// failed or didn't answer in time. A provider that ignores its context
// doesn't hold the others up: its late answer is dropped.
func Aggregate(ctx context.Context, ps []Provider, r Request, timeout time.Duration) ([]Stream, []ProviderError) {
	type result struct {
		streams []Stream
		err     error
		ran     bool
	}
	results := make([]result, len(ps))
	var wg sync.WaitGroup
	for i, p := range ps {
		if p == nil || !p.Supports(r.Type) {
			continue
		}
		results[i].ran = true
		wg.Add(1)
		go func(i int, p Provider) {
			defer wg.Done()
			streams, err := callWithTimeout(ctx, timeout, func(ctx context.Context) ([]Stream, error) {
				return p.Streams(ctx, r)
			})
			results[i].streams, results[i].err = streams, err
		}(i, p)
	}
	wg.Wait()

	var out []Stream
	var errs []ProviderError
	for i, res := range results {
		if !res.ran {
			continue
		}
		p := ps[i]
		if res.err != nil {
			errs = append(errs, ProviderError{Provider: p.ID(), Name: p.Name(), Message: res.err.Error()})
			continue
		}
		for _, s := range res.streams {
			if !Playable(s) {
				continue
			}
			if s.Provider == "" {
				s.Provider = p.ID()
			}
			if s.ProviderName == "" {
				s.ProviderName = p.Name()
			}
			out = append(out, normalize(s))
		}
	}
	return Dedupe(out), errs
}

// AggregateSubtitles asks every subtitle provider at once, like Aggregate.
func AggregateSubtitles(ctx context.Context, ps []SubtitleProvider, r Request, timeout time.Duration) ([]Subtitle, []ProviderError) {
	type result struct {
		subs []Subtitle
		err  error
	}
	results := make([]result, len(ps))
	var wg sync.WaitGroup
	for i, p := range ps {
		if p == nil {
			continue
		}
		wg.Add(1)
		go func(i int, p SubtitleProvider) {
			defer wg.Done()
			subs, err := callWithTimeout(ctx, timeout, func(ctx context.Context) ([]Subtitle, error) {
				return p.Subtitles(ctx, r)
			})
			results[i] = result{subs, err}
		}(i, p)
	}
	wg.Wait()
	var out []Subtitle
	var errs []ProviderError
	seen := map[string]bool{}
	for i, res := range results {
		if res.err != nil {
			id, name := describeAny(ps[i])
			errs = append(errs, ProviderError{Provider: id, Name: name, Message: res.err.Error()})
			continue
		}
		for _, s := range res.subs {
			if s.URL == "" || seen[s.URL] {
				continue
			}
			seen[s.URL] = true
			out = append(out, s)
		}
	}
	return out, errs
}

func describeAny(p any) (id, name string) {
	if x, ok := p.(interface{ ID() string }); ok {
		id = x.ID()
	}
	if x, ok := p.(interface{ Name() string }); ok {
		name = x.Name()
	}
	if name == "" {
		name = id
	}
	return id, name
}

// callWithTimeout runs fn with a deadline and returns when it's done or
// when the deadline passes, whichever comes first. Panics become errors.
func callWithTimeout[T any](ctx context.Context, timeout time.Duration, fn func(context.Context) (T, error)) (T, error) {
	var cancel context.CancelFunc
	if timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, timeout)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	defer cancel()
	type result struct {
		v   T
		err error
	}
	ch := make(chan result, 1)
	go func() {
		var res result
		defer func() {
			if p := recover(); p != nil {
				res.err = fmt.Errorf("internal error: %v", p)
			}
			ch <- res
		}()
		res.v, res.err = fn(ctx)
	}()
	select {
	case res := <-ch:
		if res.err != nil && errors.Is(res.err, context.DeadlineExceeded) && timeout > 0 {
			res.err = fmt.Errorf("no answer within %s", timeout)
		}
		return res.v, res.err
	case <-ctx.Done():
		var zero T
		if errors.Is(ctx.Err(), context.DeadlineExceeded) && timeout > 0 {
			return zero, fmt.Errorf("no answer within %s", timeout)
		}
		return zero, ctx.Err()
	}
}

// normalize fills the fields every consumer expects.
func normalize(s Stream) Stream {
	if s.InfoHash == "" && s.Magnet == "" {
		s.FileIdx = -1
	}
	if s.Type == "" {
		s.Type = StreamUnknown
		if s.Direct() {
			s.Type = GuessType(s.URL)
			if s.Type == StreamUnknown && s.Filename != "" {
				s.Type = GuessType(s.Filename)
			}
		}
	}
	return s
}
