"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

type BookingSlotRow = {
  slot_time: string;
};

type BookingLookupRow = {
  id: string;
  event_date: string;
  slot_time: string;
  person1: string;
  person2: string;
  phone1: string;
};

type ReservationDraft = {
  person1: string;
  person2: string;
  phone: string;
};

type RescheduleDraft = {
  newDate: string;
  newSlot: string;
};

type DateOption = {
  label: string;
  value: string;
};

type Slot = {
  label: string;
  value: string;
  isLunch: boolean;
};

const DATE_OPTIONS: DateOption[] = [
  { label: "Sábado • 22/08/2026", value: "2026-08-22" },
  { label: "Domingo • 23/08/2026", value: "2026-08-23" },
];

const CLASS_OPTIONS = ["Cozinha", "Ordem", "Liturgia", "Secretaria", "Compras", "Círculo", "Dirigente", "Palestra"];

const START_MINUTES = 7 * 60;
const END_MINUTES_SATURDAY = 20 * 60;
const END_MINUTES_SUNDAY = 12 * 60;
const STEP_MINUTES = 30;
const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;

const defaultFormState = {
  className: "",
  person1: "",
  person2: "",
  ddd: "",
  number: "",
};

const toTimeLabel = (minutes: number) => {
  const hour = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const min = (minutes % 60).toString().padStart(2, "0");
  return `${hour}:${min}`;
};

const getSlotsForDate = (date: string): Slot[] => {
  const isSunday = date === "2026-08-23";
  const endMinutes = isSunday ? END_MINUTES_SUNDAY : END_MINUTES_SATURDAY;

  return Array.from(
    { length: Math.floor((endMinutes - START_MINUTES) / STEP_MINUTES) + 1 },
    (_, idx) => {
      const minutePoint = START_MINUTES + idx * STEP_MINUTES;
      const label = toTimeLabel(minutePoint);
      const isLunch =
        !isSunday && minutePoint >= LUNCH_START && minutePoint < LUNCH_END;

      return {
        label,
        value: `${label}:00`,
        isLunch,
      };
    }
  );
};

const formatDateToBrShort = (yyyyMmDd: string) => {
  const [year, month, day] = yyyyMmDd.split("-");
  return `${day}/${month}/${year.slice(2)}`;
};

export default function Home() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const logoSrc = `${basePath}/equipe-liturgia-bg-logo.jpg`;
  const mobileBgSrc = `${basePath}/equipe-liturgia-bg-MOBILE.jpg`;
  const desktopBgSrc = `${basePath}/equipe-liturgia-bg.jpg`;

  const [selectedDate, setSelectedDate] = useState(DATE_OPTIONS[0].value);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState(defaultFormState);

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupDdd, setLookupDdd] = useState("");
  const [lookupNumber, setLookupNumber] = useState("");
  const [lookupResult, setLookupResult] = useState<BookingLookupRow | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingLookupRow | null>(null);
  const [phoneConfirmDraft, setPhoneConfirmDraft] = useState<ReservationDraft | null>(null);
  const [rescheduleConfirmDraft, setRescheduleConfirmDraft] = useState<RescheduleDraft | null>(null);

  const [isLoadingSlots, setIsLoadingSlots] = useState(Boolean(supabase));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  const slots = useMemo(() => getSlotsForDate(selectedDate), [selectedDate]);

  const fetchBookings = useCallback(async (date: string) => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("bookings")
      .select("slot_time")
      .eq("event_date", date)
      .eq("status", "active");

    if (error) {
      setErrorMessage("Erro ao buscar horários. Atualize a página e tente novamente.");
      setIsLoadingSlots(false);
      return;
    }

    const reserved = new Set(
      (data as BookingSlotRow[]).map((booking) => booking.slot_time.slice(0, 8))
    );

    setBookings(reserved);
    setIsLoadingSlots(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBookings(selectedDate);
  }, [fetchBookings, selectedDate]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel("bookings-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        () => {
          void fetchBookings(selectedDate);
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [fetchBookings, selectedDate]);

  const totalBookable = useMemo(
    () => slots.filter((slot) => !slot.isLunch).length,
    [slots]
  );

  const remainingSlots = useMemo(
    () => Math.max(totalBookable - bookings.size, 0),
    [bookings.size, totalBookable]
  );

  const canBook = !!supabase;
  const insertNewBooking = useCallback(
    async (draft: ReservationDraft, date: string, slot: string) => {
      if (!supabase) return { ok: false as const, reason: "no-client" };

      const { data: existingByPhone, error: checkPhoneError } = await supabase
        .from("bookings")
        .select("id")
        .eq("phone1", draft.phone)
        .eq("status", "active")
        .limit(1);

      if (checkPhoneError) {
        return { ok: false as const, reason: "phone-check" };
      }

      if (existingByPhone && existingByPhone.length > 0) {
        return { ok: false as const, reason: "phone-exists" };
      }

      const { error } = await supabase.from("bookings").insert({
        event_date: date,
        slot_time: slot,
        person1: draft.person1,
        person2: draft.person2,
        phone1: draft.phone,
        phone2: "",
        status: "active",
      });

      if (error) {
        return { ok: false as const, reason: "insert" };
      }

      return { ok: true as const };
    },
    []
  );


  const cancelReservationById = useCallback(async (bookingId: string) => {
    if (!supabase) return false;

    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", canceled_at: new Date().toISOString() })
      .eq("id", bookingId)
      .eq("status", "active");

    if (error) {
      setLookupMessage("Não foi possível cancelar a reserva agora. Tente novamente.");
      return false;
    }

    return true;
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const client = supabase;

    if (!selectedSlot || !client) {
      setErrorMessage("Configuração do banco ausente. Configure o Supabase para habilitar reservas.");
      return;
    }

    if (!formData.className) {
      setErrorMessage("Selecione a sua equipe.");
      return;
    }

    if (!formData.person1.trim() || !formData.person2.trim()) {
      setErrorMessage("Os dois nomes do casal são obrigatórios.");
      return;
    }

    const ddd = formData.ddd.trim();
    const number = formData.number.trim();
    const phone = ddd + number;

    if (!ddd || !number) {
      setErrorMessage("Preencha DDD e telefone de contato.");
      return;
    }

    if (!/^\d{2}$/.test(ddd)) {
      setErrorMessage("DDD deve ter 2 dígitos numéricos.");
      return;
    }

    if (!/^\d{8,9}$/.test(number)) {
      setErrorMessage("Telefone deve ter 8 ou 9 dígitos numéricos.");
      return;
    }

    setErrorMessage(null);
    setMessage(null);

    if (rescheduleTarget) {
      setErrorMessage("Para remarcar, escolha um novo horário e confirme no pop-out.");
      return;
    }

    setPhoneConfirmDraft({
      person1: formData.person1.trim(),
      person2: formData.person2.trim(),
      phone,
    });
  };

  const handleConfirmPhoneReservation = async () => {
    if (!phoneConfirmDraft || !selectedSlot) return;

    setIsSubmitting(true);
    const result = await insertNewBooking(phoneConfirmDraft, selectedDate, selectedSlot);
    setIsSubmitting(false);

    if (!result.ok) {
      if (result.reason === "phone-exists") {
        setErrorMessage("Este número já possui um horário reservado. Cancele a reserva atual para escolher outro horário.");
      } else if (result.reason === "phone-check") {
        setErrorMessage("Erro ao validar telefone. Tente novamente.");
      } else {
        setErrorMessage("Não foi possível concluir o agendamento. Se o telefone já estiver reservado, cancele antes de remarcar.");
      }
      return;
    }

    setMessage("Agendamento realizado com sucesso.");
    setSelectedSlot(null);
    setFormData(defaultFormState);
    setPhoneConfirmDraft(null);
    void fetchBookings(selectedDate);
  };

  const handleLookupReservation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    const ddd = lookupDdd.trim();
    const number = lookupNumber.trim();
    const phone = ddd && number ? `${ddd}${number}` : "";

    if (!phone) {
      setLookupMessage("Informe DDD e telefone para consultar.");
      setLookupResult(null);
      return;
    }

    if (!/^\d{2}$/.test(ddd) || !/^\d{8,9}$/.test(number)) {
      setLookupMessage("Telefone inválido. Verifique DDD e número.");
      setLookupResult(null);
      return;
    }

    setIsLookingUp(true);
    setLookupMessage(null);
    setLookupResult(null);

    const { data, error } = await supabase
      .from("bookings")
      .select("id, event_date, slot_time, person1, person2, phone1")
      .eq("status", "active")
      .eq("phone1", phone)
      .limit(1);

    setIsLookingUp(false);

    if (error) {
      setLookupMessage("Erro ao consultar reserva. Tente novamente.");
      return;
    }

    const result = (data as BookingLookupRow[])[0];
    if (!result) {
      setLookupMessage("Nenhuma reserva ativa encontrada com este telefone.");
      return;
    }

    setLookupResult(result);
  };

  const handleCancelReservation = async () => {
    if (!lookupResult) return;

    setCancelingId(lookupResult.id);
    const ok = await cancelReservationById(lookupResult.id);
    setCancelingId(null);

    if (!ok) return;

    setLookupMessage("Reserva cancelada com sucesso.");
    setLookupResult(null);
    setErrorMessage(null);
    setMessage("Horário liberado. Agora você pode reservar outro horário.");
    void fetchBookings(selectedDate);
  };

  const handleRescheduleReservation = async () => {
    if (!lookupResult) return;

    const ddd = lookupResult.phone1.slice(0, 2);
    const number = lookupResult.phone1.slice(2);

    setRescheduleTarget(lookupResult);
    setSelectedDate(lookupResult.event_date);
    setIsLoadingSlots(true);
    setSelectedSlot(null);
    setFormData({
      className: "",
      person1: lookupResult.person1,
      person2: lookupResult.person2,
      ddd,
      number,
    });

    setLookupOpen(false);
    setLookupResult(null);
    setLookupMessage("Agora escolha um novo horário e confirme a remarcação.");
    setMessage("Modo remarcar ativo. Após escolher o novo horário, confirme em SIM ou NÃO.");
    void fetchBookings(selectedDate);
  };

  const handleConfirmReschedule = async () => {
    if (!supabase || !rescheduleTarget || !rescheduleConfirmDraft) return;

    setIsFinalizing(true);

    const { error } = await supabase
      .from("bookings")
      .update({
        event_date: rescheduleConfirmDraft.newDate,
        slot_time: rescheduleConfirmDraft.newSlot,
      })
      .eq("id", rescheduleTarget.id)
      .eq("status", "active");

    setIsFinalizing(false);

    if (error) {
      setErrorMessage("Não foi possível remarcar agora. Tente outro horário ou cancele a reserva.");
      return;
    }

    setMessage("Reserva remarcada com sucesso.");
    setRescheduleConfirmDraft(null);
    setRescheduleTarget(null);
    setSelectedSlot(null);
    setFormData(defaultFormState);
    void fetchBookings(rescheduleConfirmDraft.newDate);
  };

  const handleRejectReschedule = () => {
    setRescheduleConfirmDraft(null);
    setMessage("Escolha outro horário para remarcar ou cancele a reserva atual.");
  };

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat md:hidden"
          style={{ backgroundImage: `url('${mobileBgSrc}')` }}
        />
        <div
          className="absolute inset-0 hidden bg-cover bg-center bg-no-repeat md:block"
          style={{ backgroundImage: `url('${desktopBgSrc}')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white/12 via-white/10 to-[#fffdf8]/10"  />
        <div className="absolute inset-0 backdrop-blur-[2px]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <header className="panel-glow fade-up rounded-3xl border border-white/70 px-6 py-8 text-center sm:px-10">
        <p className="mb-3 inline-flex rounded-full bg-[var(--brand-soft)] px-4 py-1 text-xs font-semibold tracking-[0.2em] text-[var(--brand)] uppercase">
          Agenda Oficial
        </p>
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-3 sm:gap-4">
          <Image
            src={logoSrc}
            alt="Logo do encontro"
            width={64}
            height={64}
            unoptimized
            className="h-12 w-12 rounded-full border border-white/70 object-cover shadow-sm sm:h-16 sm:w-16"
          />
          <h1 className="text-3xl leading-tight text-slate-900 sm:text-4xl lg:text-5xl">
            16° ECC - CONVERSA Á TRÊS
          </h1>
        </div>
        <p className="mx-auto mt-4 text-sm text-slate-600 sm:text-base">
          Reserva de horários.
        </p>
      </header>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="panel-glow fade-up stagger-1 rounded-3xl border border-white/70 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl text-slate-900">Selecione a data</h2>
            <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
              Vagas restantes: {remainingSlots}/{totalBookable}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {DATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setIsLoadingSlots(true);
                  setSelectedDate(option.value);
                  setSelectedSlot(null);
                  setMessage(null);
                  setErrorMessage(null);
                }}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all duration-300 ${
                  selectedDate === option.value
                    ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-md"
                    : "border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-[var(--brand)] hover:text-[var(--brand)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="text-lg text-slate-900">Horários disponíveis</h3>
            <p className="mt-1 text-sm text-slate-600 text-center">
              • Verde: disponível • Vermelho: indisponível • 
            </p>

            {isLoadingSlots ? (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {Array.from({ length: 20 }).map((_, idx) => (
                  <div key={idx} className="h-11 animate-pulse rounded-xl bg-slate-200" />
                ))}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {slots.map((slot) => {
                  const isReserved = bookings.has(slot.value);
                  const isBlocked = slot.isLunch || isReserved;
                  const isSelected = selectedSlot === slot.value;

                  return (
                    <button
                      key={slot.value}
                      type="button"
                      disabled={isBlocked || !canBook}
                      onClick={() => {
                        setSelectedSlot(slot.value);
                        setMessage(null);
                        setErrorMessage(null);
                        if (rescheduleTarget) {
                          setRescheduleConfirmDraft({
                            newDate: selectedDate,
                            newSlot: slot.value,
                          });
                        }
                      }}
                      className={`h-11 rounded-xl border text-sm font-semibold transition-all duration-200 ${
                        slot.isLunch
                          ? "cursor-not-allowed border-slate-300 bg-[var(--muted)]/45 text-slate-600"
                          : isReserved
                            ? "cursor-not-allowed border-red-300 bg-[var(--danger)]/20 text-red-700"
                            : isSelected
                              ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-md"
                              : "border-green-300 bg-[var(--ok)]/15 text-green-800 hover:-translate-y-0.5 hover:bg-[var(--ok)]/25"
                      }`}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </article>

        <aside className="panel-glow fade-up stagger-2 rounded-3xl border border-white/70 p-5 sm:p-6">
          <h2 className="text-2xl text-slate-900">Formulário do casal</h2>
          <p className="mt-1 text-sm text-slate-600">
            {selectedSlot
              ? `Horário selecionado: ${selectedSlot.slice(0, 5)} (${formatDateToBrShort(selectedDate)})`
              : "Escolha um horário verde para abrir o agendamento."}
          </p>

          {!canBook && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para habilitar reservas.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div>
              <label htmlFor="className" className="mb-1 block text-xs font-semibold tracking-wide text-slate-700 uppercase">
              </label>
              <select
                id="className"
                value={formData.className}
                disabled={!selectedSlot || !canBook}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, className: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              >
                <option value="">Selecione a sua equipe</option>
                {CLASS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <input
              type="text"
              placeholder="Nome do Marido"
              value={formData.person1}
              disabled={!selectedSlot || !canBook}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, person1: event.target.value }))
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
              required
            />

            <input
              type="text"
              placeholder="Nome da Esposa"
              value={formData.person2}
              disabled={!selectedSlot || !canBook}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, person2: event.target.value }))
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
              required
            />

            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{2}"
                maxLength={2}
                placeholder="DDD"
                value={formData.ddd}
                disabled={!selectedSlot || !canBook}
                onChange={(event) => {
                  const val = event.target.value.replace(/\D/g, "").slice(0, 2);
                  setFormData((prev) => ({ ...prev, ddd: val }));
                }}
                className="w-16 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              />
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{8,9}"
                maxLength={9}
                placeholder="Telefone para contato"
                value={formData.number}
                disabled={!selectedSlot || !canBook}
                onChange={(event) => {
                  const val = event.target.value.replace(/\D/g, "").slice(0, 9);
                  setFormData((prev) => ({ ...prev, number: val }));
                }}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                required
              />
            </div>

            <button
              type="submit"
              disabled={!selectedSlot || isSubmitting || !canBook || isFinalizing}
              className="flex w-full items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Salvando...
                </span>
              ) : (
                "Confirmar agendamento"
              )}
            </button>            
          </form>

          <div className="mt-6 border-t border-slate-400 pt-4">
            <button
              type="button"
              onClick={() => {
                setLookupOpen(true);
                setLookupResult(null);
                setLookupMessage(null);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Consultar reserva
            </button>
          </div>

          {errorMessage && (
            <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {errorMessage}
            </p>
          )}

          {message && (
            <p className="mt-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
              {message}
            </p>
          )}
        </aside>
      </section>

      {phoneConfirmDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-amber-900">Confirmar telefone</h3>
            <p className="mt-2 text-sm text-amber-900">
              Você confirma que o seu número é <span className="font-semibold">({phoneConfirmDraft.phone.slice(0, 2)}) {phoneConfirmDraft.phone.slice(2)}</span>?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleConfirmPhoneReservation()}
                disabled={isSubmitting}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
              >
                {isSubmitting ? "Confirmando..." : "Confirmar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhoneConfirmDraft(null);
                  setMessage("Revise o telefone e confirme novamente.");
                }}
                disabled={isSubmitting}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {rescheduleConfirmDraft && rescheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-indigo-300 bg-indigo-50 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-indigo-900">Confirmar remarcação</h3>
            <p className="mt-2 text-sm text-indigo-900">
              Deseja remarcar para <span className="font-semibold">{formatDateToBrShort(rescheduleConfirmDraft.newDate)} às {rescheduleConfirmDraft.newSlot.slice(0, 5)}</span>?
            </p>
            <p className="mt-1 text-xs text-indigo-900">
              Reserva atual: {formatDateToBrShort(rescheduleTarget.event_date)} às {rescheduleTarget.slot_time.slice(0, 5)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleConfirmReschedule()}
                disabled={isFinalizing}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
              >
                {isFinalizing ? "Confirmando..." : "SIM"}
              </button>
              <button
                type="button"
                onClick={handleRejectReschedule}
                disabled={isFinalizing}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                NÃO
              </button>
            </div>
          </div>
        </div>
      )}

      {lookupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-slate-900">Consultar reserva</h3>
              <button
                type="button"
                onClick={() => setLookupOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-600">Informe o telefone para localizar sua reserva ativa.</p>

            <form onSubmit={handleLookupReservation} className="mt-3 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{2}"
                  maxLength={2}
                  placeholder="DDD"
                  value={lookupDdd}
                  disabled={!canBook || isLookingUp}
                  onChange={(event) =>
                    setLookupDdd(event.target.value.replace(/\D/g, "").slice(0, 2))
                  }
                  className="w-16 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                  required
                />
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{8,9}"
                  maxLength={9}
                  placeholder="Telefone"
                  value={lookupNumber}
                  disabled={!canBook || isLookingUp}
                  onChange={(event) =>
                    setLookupNumber(event.target.value.replace(/\D/g, "").slice(0, 9))
                  }
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none transition focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={!canBook || isLookingUp}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLookingUp ? "Consultando..." : "Buscar reserva"}
              </button>
            </form>

            {lookupResult && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">
                  {lookupResult.person1} e {lookupResult.person2}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {formatDateToBrShort(lookupResult.event_date)} às {lookupResult.slot_time.slice(0, 5)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCancelReservation()}
                    disabled={cancelingId === lookupResult.id}
                    className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancelingId === lookupResult.id ? "Cancelando..." : "Cancelar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRescheduleReservation()}
                    disabled={cancelingId === lookupResult.id}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cancelingId === lookupResult.id ? "Remarcando..." : "Remarcar"}
                  </button>
                </div>
              </div>
            )}

            {lookupMessage && (
              <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {lookupMessage}
              </p>
            )}
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
