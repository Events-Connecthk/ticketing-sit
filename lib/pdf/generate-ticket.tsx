/**
 * PDF Ticket Generator
 *
 * Uses @react-pdf/renderer for clean, professional, print-ready tickets.
 * The ticket is self-contained with all important details + a simple
 * "barcode-like" reference for entry scanning (can be upgraded to QR later).
 *
 * Why PDF on server:
 * - Reliable visual result independent of client
 * - Can be emailed as attachment
 * - Consistent branding
 */

import { EventConfig, BuyerInfo, TicketSelection } from "@/types";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import React from "react";

interface GenerateTicketParams {
  event: EventConfig;
  buyer: BuyerInfo;
  tickets: TicketSelection[];
  orderReference: string;
  purchaseId?: string;
  amount: number;
  currency: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    backgroundColor: "#ffffff",
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 24,
    borderBottom: "2px solid #111",
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#111111",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#555",
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 10,
    color: "#666",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 16,
    color: "#111",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  ticketBox: {
    border: "1px solid #ddd",
    padding: 16,
    marginBottom: 12,
    backgroundColor: "#fafafa",
  },
  reference: {
    fontSize: 22,
    fontFamily: "Courier",
    letterSpacing: 3,
    marginTop: 8,
    backgroundColor: "#111",
    color: "#fff",
    padding: "10px 14px",
    alignSelf: "flex-start",
  },
  footer: {
    marginTop: 32,
    fontSize: 9,
    color: "#888",
    textAlign: "center",
  },
  total: {
    fontSize: 18,
    fontWeight: "bold",
  },
});

function TicketDocument({
  event,
  buyer,
  tickets,
  orderReference,
  amount,
  currency,
}: Omit<GenerateTicketParams, "purchaseId">) {
  const totalTickets = tickets.reduce((sum, t) => sum + t.quantity, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{event.name}</Text>
          <Text style={styles.subtitle}>Official Ticket</Text>
        </View>

        {/* Event Info */}
        <View style={styles.section}>
          <Text style={styles.label}>Event Details</Text>
          <Text style={styles.value}>
            {event.date} {event.time ? `• ${event.time}` : ""}
          </Text>
          <Text style={styles.value}>{event.location}</Text>
        </View>

        {/* Buyer */}
        <View style={styles.section}>
          <Text style={styles.label}>Attendee</Text>
          <Text style={styles.value}>{buyer.name}</Text>
          <Text style={{ ...styles.value, fontSize: 14 }}>{buyer.email}</Text>
          <Text style={{ ...styles.value, fontSize: 14 }}>{buyer.phone}</Text>
        </View>

        {/* Tickets */}
        <View style={styles.section}>
          <Text style={styles.label}>Tickets</Text>
          {tickets.map((t, idx) => (
            <View key={idx} style={styles.ticketBox}>
              <Text style={{ fontSize: 15, marginBottom: 4 }}>
                Ticket Type: {t.ticketTypeId.toUpperCase()} × {t.quantity}
              </Text>
            </View>
          ))}
          <Text style={{ marginTop: 8, fontSize: 13 }}>Total Tickets: {totalTickets}</Text>
        </View>

        {/* Amount */}
        <View style={styles.section}>
          <Text style={styles.label}>Amount Paid</Text>
          <Text style={styles.total}>
            {currency} {amount}
          </Text>
        </View>

        {/* Order Reference - critical for entry */}
        <View style={styles.section}>
          <Text style={styles.label}>Order Reference (Present at Entry)</Text>
          <Text style={styles.reference}>{orderReference}</Text>
        </View>

        <Text style={styles.footer}>
          This is your official ticket. Please keep this document safe. Non-transferable unless otherwise stated.
        </Text>
      </Page>
    </Document>
  );
}

export async function generateTicketPdf(
  params: GenerateTicketParams
): Promise<{ success: boolean; pdfBuffer?: Buffer; filename?: string; error?: string }> {
  try {
    const filename = `ticket-${params.event.slug}-${params.orderReference}.pdf`;

    // Render the PDF to a Buffer (JSX component passed directly)
    const blob = await pdf(
      <TicketDocument
        event={params.event}
        buyer={params.buyer}
        tickets={params.tickets}
        orderReference={params.orderReference}
        amount={params.amount}
        currency={params.currency}
      />
    ).toBlob();

    // Convert blob -> buffer (Node compatible)
    const arrayBuffer = await blob.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    return {
      success: true,
      pdfBuffer,
      filename,
    };
  } catch (error) {
    console.error("[PDF] Ticket generation failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "PDF generation error",
    };
  }
}
