"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Mail,
  Phone,
  AlertTriangle,
  Shield,
  Camera,
  Bell,
  MapPin,
  BarChart3,
} from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
  icon: any;
}

const faqs: FAQItem[] = [
  {
    question: "How do I report an incident?",
    answer: "Tap the + button at the top of the screen, take a photo or video of the incident, select a category, add a description if needed, and post. Your location is automatically captured.",
    icon: Camera,
  },
  {
    question: "What is the SOS feature?",
    answer: "The SOS feature is for personal emergencies. Press and hold the SOS button for 3 seconds to alert your emergency contacts and nearby users. Your live location will be shared for 5 hours. Misuse of this feature will result in a permanent ban.",
    icon: AlertTriangle,
  },
  {
    question: "How do I become a Guardian?",
    answer: "Guardians are trusted community moderators. To qualify, you need: 30+ day old account, 10+ confirmed posts, 50+ reputation score, and zero violations. Apply through your profile page.",
    icon: Shield,
  },
  {
    question: "Why should I confirm incidents?",
    answer: "Confirming incidents helps verify their accuracy. When multiple users confirm an incident, it increases trust and helps others know the report is real.",
    icon: Bell,
  },
  {
    question: "How do location alerts work?",
    answer: "You can set up alerts for: All of Nigeria, specific states, a custom radius around you, or saved locations like home and work. Customize this in Settings.",
    icon: MapPin,
  },
  {
    question: "What does the Analytics button do?",
    answer: "The Analytics button on the map shows you data insights about incidents in your area. View trends, hotspots, incident frequency by category, and time-based patterns. This helps you understand safety conditions and make informed decisions about where and when to travel.",
    icon: BarChart3,
  },
];

export default function HelpPage() {
  const router = useRouter();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Help & Support</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4 py-6">
        {/* Quick Contact */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Contact Us
          </h2>
          <div className="grid grid-cols-1 gap-3">
            <a
              href="mailto:pejastudios@gmail.com"
              className="flex items-center gap-3 p-4 glass-card hover:bg-white/5 transition-colors"
            >
              <div className="p-2 rounded-lg bg-primary-600/20">
                <Mail className="w-5 h-5 text-primary-400" />
              </div>
              <div>
                <p className="font-medium text-dark-100">Email Support</p>
                <p className="text-sm text-dark-400">pejastudios@gmail.com</p>
              </div>
            </a>

            <a
              href="https://wa.link/2il66e"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 glass-card hover:bg-white/5 transition-colors"
            >
              <div className="p-2 rounded-lg bg-green-600/20">
                <MessageCircle className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="font-medium text-dark-100">WhatsApp</p>
                <p className="text-sm text-dark-400">Chat with us</p>
              </div>
            </a>
          </div>
        </section>

        {/* FAQs */}
        <section>
          <h2 className="text-sm font-semibold text-dark-400 uppercase mb-4">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {faqs.map((faq, index) => {
              const Icon = faq.icon;
              const isExpanded = expandedIndex === index;

              return (
                <div key={index} className="glass-card overflow-hidden">
                  <button
                    onClick={() => setExpandedIndex(isExpanded ? null : index)}
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-dark-700">
                        <Icon className="w-4 h-4 text-primary-400" />
                      </div>
                      <span className="font-medium text-dark-100">{faq.question}</span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-dark-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-dark-400" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0">
                      <p className="text-dark-300 leading-relaxed pl-11">
                        {faq.answer}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Still need help */}
        <section className="mt-8">
          <div className="glass-card text-center py-8">
            <h3 className="text-lg font-semibold text-dark-100 mb-2">
              Still need help?
            </h3>
            <p className="text-dark-400 mb-4">
              Our support team is available 24/7
            </p>
            <a
              href="mailto:support@peja.ng"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 hover:bg-primary-700 rounded-xl text-white font-medium transition-colors"
            >
              <Mail className="w-5 h-5" />
              Contact Support
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}