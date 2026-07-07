"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { loadAllEvents } from "@/lib/config/events";
import { EventConfig } from "@/types";
import { isSupabaseConfigured } from "@/lib/db/events";
import { Calendar, MapPin } from "lucide-react";

/**
 * Event Catalogue Page
 * Lists all enabled events. Replaces direct link to single event.
 */

export default function EventsCatalogue() {
  const [events, setEvents] = useState<EventConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSupabase] = useState(isSupabaseConfigured());

  useEffect(() => {
    loadAllEvents().then((all) => {
      const enabled = all.filter((e) => e.enabled !== false);
      setEvents(enabled);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F5' }}>
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-semibold tracking-tight text-[#2C2520]">Events</h1>
          <p className="mt-2" style={{ color: '#6B5E50' }}>
            Browse and purchase tickets for upcoming events.
            <span className="ml-2 text-xs">({usingSupabase ? "Supabase" : "Memory - not persisted"})</span>
          </p>
        </div>

        {loading && (
          <div className="text-center py-12" style={{ color: '#6B5E50' }}>Loading events...</div>
        )}

        {!loading && events.length === 0 && (
          <div className="rounded-2xl border card p-8 text-center" style={{ borderColor: '#EDE4D3' }}>
            <p style={{ color: '#6B5E50' }}>No events are currently available.</p>
            <p className="text-xs mt-1" style={{ color: '#6B5E50' }}>
              {usingSupabase ? "Events are stored in Supabase." : "Currently using in-memory storage (set Supabase keys + restart to persist)."}
            </p>
            <p className="mt-2 text-xs">Contact the event organizer to add events.</p>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <Link
              key={event.slug}
              href={`/${event.slug}`}
              className="block rounded-2xl border card overflow-hidden hover:shadow-md transition-shadow"
              style={{ borderColor: '#EDE4D3' }}
            >
              {event.image && (
                <div className="w-full h-28 overflow-hidden">
                  <img src={event.image} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-6">
                <h3 className="text-xl font-semibold mb-2 text-[#2C2520]">{event.name}</h3>

                <div className="flex items-center gap-2 text-sm mb-1" style={{ color: '#3A2F23' }}>
                  <Calendar className="h-4 w-4" />
                  <span>{event.date}{event.time ? ` • ${event.time}` : ""}</span>
                </div>

                <div className="flex items-center gap-2 text-sm mb-4" style={{ color: '#3A2F23' }}>
                  <MapPin className="h-4 w-4" />
                  <span>{event.location}</span>
                </div>

                {event.description && (
                  <p className="text-sm line-clamp-3" style={{ color: '#6B5E50' }}>
                    {event.description}
                  </p>
                )}

                <div className="mt-4 text-sm font-medium" style={{ color: '#C5A26E' }}>
                  View tickets →
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/"
            className="text-sm underline"
            style={{ color: '#6B5E50' }}
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
