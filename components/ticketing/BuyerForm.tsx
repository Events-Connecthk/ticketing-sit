"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BuyerInfo } from "@/types";
import { User, Phone, Mail } from "lucide-react";

const buyerSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  phone: z
    .string()
    .min(6, "Please enter a valid phone number")
    .regex(/^[+\d\s()-]+$/, "Phone can only contain digits and common symbols"),
  email: z.string().email("Please enter a valid email address"),
});

type BuyerFormValues = z.infer<typeof buyerSchema>;

interface BuyerFormProps {
  defaultValues?: Partial<BuyerInfo>;
  onSubmit: (data: BuyerInfo) => void;
  onBack?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

/**
 * Professional buyer information form.
 * Uses Zod + React Hook Form for validation and clean UX.
 */
export function BuyerForm({
  defaultValues,
  onSubmit,
  onBack,
  isSubmitting = false,
  submitLabel = "Proceed to Checkout",
}: BuyerFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<BuyerFormValues>({
    resolver: zodResolver(buyerSchema),
    defaultValues: {
      name: defaultValues?.name || "",
      phone: defaultValues?.phone || "",
      email: defaultValues?.email || "",
    },
    mode: "onBlur",
  });

  const handleFormSubmit = (values: BuyerFormValues) => {
    onSubmit(values as BuyerInfo);
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700" htmlFor="name">
          Full Name
        </label>
        <div className="relative">
          <User className="absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
          <input
            id="name"
            type="text"
            {...register("name")}
            placeholder="Alex Rivera"
            className="w-full rounded-lg border pl-10 py-3 text-base placeholder:text-[#6B5E50] focus:outline-none focus:ring-1"
            style={{ borderColor: '#EDE4D3', background: 'white', color: '#2C2520' }}
          />
        </div>
        {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700" htmlFor="phone">
          Phone Number
        </label>
        <div className="relative">
          <Phone className="absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
          <input
            id="phone"
            type="tel"
            {...register("phone")}
            placeholder="+852 9123 4567"
            className="w-full rounded-lg border pl-10 py-3 text-base placeholder:text-[#6B5E50] focus:outline-none focus:ring-1"
            style={{ borderColor: '#EDE4D3', background: 'white', color: '#2C2520' }}
          />
        </div>
        {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700" htmlFor="email">
          Email Address
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
          <input
            id="email"
            type="email"
            {...register("email")}
            placeholder="you@example.com"
            className="w-full rounded-lg border pl-10 py-3 text-base placeholder:text-[#6B5E50] focus:outline-none focus:ring-1"
            style={{ borderColor: '#EDE4D3', background: 'white', color: '#2C2520' }}
          />
        </div>
        {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
      </div>

      <div className="flex gap-3 pt-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-lg border py-3 font-medium hover:bg-white/70 transition-colors"
            style={{ borderColor: '#EDE4D3', color: '#3A2F23' }}
          >
            Back
          </button>
        )}
        <button
          type="submit"
          disabled={!isValid || isSubmitting}
          className="btn-gold flex-1 rounded-lg py-3 font-medium disabled:opacity-60"
        >
          {isSubmitting ? "Please wait..." : submitLabel}
        </button>
      </div>

      <p className="text-center text-xs text-zinc-500">
        We’ll only use your details to send your tickets and important event updates.
      </p>
    </form>
  );
}
