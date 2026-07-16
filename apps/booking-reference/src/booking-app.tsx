import {
  action,
  createMemo,
  createOptimistic,
  createSignal,
  Errored,
  For,
  Loading,
  refresh,
  Show,
} from 'solid-js'

import { runSpecterCommand, specterTransport } from './specter-transport'

const statusOptions = ['all', 'pending', 'approved', 'checkedIn', 'released']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function toIso(day: string, time: string) {
  return new Date(`${day}T${time}:00`).toISOString()
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function BookingApp() {
  const [day, setDay] = createSignal(today())
  const [status, setStatus] = createSignal('all')
  const schedule = createMemo(() =>
    specterTransport.query({
      type: 'roomScheduleQuery',
      payload: { day: day(), status: status() },
    }),
  )
  const pending = createMemo(() =>
    specterTransport.query({ type: 'pendingApprovalsQuery', payload: {} }),
  )
  const activity = createMemo(() =>
    specterTransport.query({ type: 'bookingActivityQuery', payload: {} }),
  )
  const [isBusy, setIsBusy] = createOptimistic(false)
  const [roomName, setRoomName] = createSignal('Focus Nook')
  const [capacity, setCapacity] = createSignal(4)
  const [location, setLocation] = createSignal('Floor 4')
  const [roomId, setRoomId] = createSignal('')
  const [requesterName, setRequesterName] = createSignal('Ada Lovelace')
  const [requesterEmail, setRequesterEmail] = createSignal('ada@example.com')
  const [purpose, setPurpose] = createSignal('Design review')
  const [startsAt, setStartsAt] = createSignal('09:00')
  const [endsAt, setEndsAt] = createSignal('10:00')
  const [approverName, setApproverName] = createSignal('Lin Chen')
  const [approverEmail, setApproverEmail] = createSignal('lin@example.com')

  const rooms = createMemo(() => schedule())
  const selectedRoomId = () => roomId() || rooms()[0]?.roomId || ''

  const createRoom = action(function* () {
    setIsBusy(true)
    yield runSpecterCommand({
      type: 'createRoom',
      payload: {
        roomId: crypto.randomUUID(),
        name: roomName(),
        capacity: capacity(),
        location: location(),
      },
    })
    refresh(schedule)
    refresh(activity)
  })

  const requestBooking = action(function* () {
    setIsBusy(true)
    yield runSpecterCommand({
      type: 'requestBooking',
      payload: {
        bookingId: crypto.randomUUID(),
        roomId: selectedRoomId(),
        requesterName: requesterName(),
        requesterEmail: requesterEmail(),
        purpose: purpose(),
        startsAt: toIso(day(), startsAt()),
        endsAt: toIso(day(), endsAt()),
      },
    })
    refresh(schedule)
    refresh(pending)
    refresh(activity)
  })

  const approve = action(function* (bookingId: string) {
    setIsBusy(true)
    yield runSpecterCommand({
      type: 'approveBooking',
      payload: {
        bookingId,
        approverName: approverName(),
        approverEmail: approverEmail(),
      },
    })
    refresh(schedule)
    refresh(pending)
    refresh(activity)
  })

  const reject = action(function* (bookingId: string) {
    setIsBusy(true)
    yield runSpecterCommand({
      type: 'rejectBooking',
      payload: {
        bookingId,
        approverName: approverName(),
        approverEmail: approverEmail(),
        reason: 'Not enough context',
      },
    })
    refresh(schedule)
    refresh(pending)
    refresh(activity)
  })

  const checkIn = action(function* (bookingId: string) {
    setIsBusy(true)
    yield runSpecterCommand({
      type: 'checkInBooking',
      payload: {
        bookingId,
        checkedInByEmail: requesterEmail(),
      },
    })
    refresh(schedule)
    refresh(activity)
  })

  const release = action(function* (bookingId: string) {
    setIsBusy(true)
    yield runSpecterCommand({
      type: 'releaseRoom',
      payload: {
        bookingId,
        releasedByEmail: requesterEmail(),
      },
    })
    refresh(schedule)
    refresh(activity)
  })

  return (
    <main class="min-h-screen bg-[#101820] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <section class="mx-auto grid max-w-7xl gap-6">
        <header class="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/25 backdrop-blur md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p class="m-0 text-xs font-bold uppercase tracking-[0.28em] text-cyan-300">
              Specter booking reference
            </p>
            <h1 class="m-0 mt-3 text-4xl font-black tracking-tight md:text-5xl">
              Meeting room ops dashboard
            </h1>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Approval-required room bookings with conflict prevention,
              lifecycle commands, independent projections, and a
              reaction-created approval notification.
            </p>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <input
              type="date"
              value={day()}
              onInput={(event) => setDay(event.currentTarget.value)}
              class="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white"
            />
            <select
              value={status()}
              onInput={(event) => setStatus(event.currentTarget.value)}
              class="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white"
            >
              <For each={statusOptions}>
                {(option) => <option value={option}>{option}</option>}
              </For>
            </select>
          </div>
        </header>

        <Errored
          fallback={(error, retry) => (
            <div class="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">
              <p>Error: {(error() as Error).message}</p>
              <button type="button" onClick={retry} class="font-bold underline">
                Retry
              </button>
            </div>
          )}
        >
          <Loading
            fallback={<p class="text-slate-300">Loading dashboard...</p>}
          >
            <section class="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
              <div class="grid gap-4">
                <For each={rooms()}>
                  {(room) => (
                    <article class="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
                        <div>
                          <h2 class="m-0 text-xl font-extrabold">
                            {room.name}
                          </h2>
                          <p class="m-0 mt-1 text-sm text-slate-400">
                            {room.location} · capacity {room.capacity}
                            <Show when={room.retired}> · retired</Show>
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy() || room.retired}
                          onClick={() =>
                            runSpecterCommand({
                              type: 'retireRoom',
                              payload: { roomId: room.roomId },
                            }).then(() => refresh(schedule))
                          }
                          class="rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-40"
                        >
                          Retire
                        </button>
                      </div>
                      <div class="mt-3 grid gap-2">
                        <Show
                          when={room.bookings.length > 0}
                          fallback={
                            <p class="text-sm text-slate-500">
                              No bookings for this view.
                            </p>
                          }
                        >
                          <For each={room.bookings}>
                            {(booking) => (
                              <div class="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                                <div class="rounded-lg bg-cyan-300 px-3 py-2 text-center text-sm font-black text-slate-950">
                                  {formatTime(booking.startsAt)}
                                  <br />
                                  {formatTime(booking.endsAt)}
                                </div>
                                <div>
                                  <p class="m-0 font-bold">{booking.purpose}</p>
                                  <p class="m-0 mt-1 text-sm text-slate-400">
                                    {booking.requesterName} · {booking.status}
                                  </p>
                                </div>
                                <div class="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={
                                      isBusy() || booking.status !== 'approved'
                                    }
                                    onClick={() => checkIn(booking.bookingId)}
                                    class="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-35"
                                  >
                                    Check in
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      isBusy() || booking.status !== 'checkedIn'
                                    }
                                    onClick={() => release(booking.bookingId)}
                                    class="rounded-lg bg-slate-200 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-35"
                                  >
                                    Release
                                  </button>
                                </div>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </article>
                  )}
                </For>
              </div>

              <aside class="grid content-start gap-4">
                <Panel title="Request booking">
                  <form
                    class="grid gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void requestBooking()
                    }}
                  >
                    <select
                      value={selectedRoomId()}
                      onInput={(event) => setRoomId(event.currentTarget.value)}
                      class="field"
                    >
                      <For each={rooms().filter((room) => !room.retired)}>
                        {(room) => (
                          <option value={room.roomId}>{room.name}</option>
                        )}
                      </For>
                    </select>
                    <input
                      class="field"
                      value={requesterName()}
                      onInput={(event) =>
                        setRequesterName(event.currentTarget.value)
                      }
                    />
                    <input
                      class="field"
                      value={requesterEmail()}
                      onInput={(event) =>
                        setRequesterEmail(event.currentTarget.value)
                      }
                    />
                    <input
                      class="field"
                      value={purpose()}
                      onInput={(event) => setPurpose(event.currentTarget.value)}
                    />
                    <div class="grid grid-cols-2 gap-2">
                      <input
                        class="field"
                        type="time"
                        value={startsAt()}
                        onInput={(event) =>
                          setStartsAt(event.currentTarget.value)
                        }
                      />
                      <input
                        class="field"
                        type="time"
                        value={endsAt()}
                        onInput={(event) =>
                          setEndsAt(event.currentTarget.value)
                        }
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isBusy() || !selectedRoomId()}
                      class="primary-button"
                    >
                      Request approval
                    </button>
                  </form>
                </Panel>

                <Panel title="Pending approvals">
                  <div class="grid gap-2">
                    <input
                      class="field"
                      value={approverName()}
                      onInput={(event) =>
                        setApproverName(event.currentTarget.value)
                      }
                    />
                    <input
                      class="field"
                      value={approverEmail()}
                      onInput={(event) =>
                        setApproverEmail(event.currentTarget.value)
                      }
                    />
                    <For each={pending()}>
                      {(booking) => (
                        <div class="rounded-xl bg-black/20 p-3">
                          <p class="m-0 font-bold">{booking.purpose}</p>
                          <p class="m-0 mt-1 text-sm text-slate-400">
                            {booking.requesterName}
                          </p>
                          <div class="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={isBusy()}
                              onClick={() => approve(booking.bookingId)}
                              class="primary-button"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={isBusy()}
                              onClick={() => reject(booking.bookingId)}
                              class="secondary-button"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Panel>

                <Panel title="Add room">
                  <form
                    class="grid gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void createRoom()
                    }}
                  >
                    <input
                      class="field"
                      value={roomName()}
                      onInput={(event) =>
                        setRoomName(event.currentTarget.value)
                      }
                    />
                    <input
                      class="field"
                      type="number"
                      min="1"
                      value={capacity()}
                      onInput={(event) =>
                        setCapacity(Number(event.currentTarget.value))
                      }
                    />
                    <input
                      class="field"
                      value={location()}
                      onInput={(event) =>
                        setLocation(event.currentTarget.value)
                      }
                    />
                    <button
                      type="submit"
                      disabled={isBusy()}
                      class="primary-button"
                    >
                      Create room
                    </button>
                  </form>
                </Panel>

                <Panel title="Activity">
                  <div class="grid gap-2">
                    <For each={activity()}>
                      {(item) => (
                        <p class="m-0 rounded-lg bg-black/20 px-3 py-2 text-sm text-slate-300">
                          {item.message}
                        </p>
                      )}
                    </For>
                  </div>
                </Panel>
              </aside>
            </section>
          </Loading>
        </Errored>
      </section>
    </main>
  )
}

function Panel(props: { title: string; children: unknown }) {
  return (
    <section class="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
      <h2 class="m-0 mb-3 text-sm font-black uppercase tracking-[0.18em] text-cyan-200">
        {props.title}
      </h2>
      {props.children}
    </section>
  )
}
