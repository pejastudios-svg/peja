"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  const router = useRouter();

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
          <h1 className="text-lg font-semibold text-dark-100">Privacy Policy</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4 py-6">
        <div className="prose prose-invert max-w-none">
          <p className="text-dark-400 text-sm mb-6">Last updated: December 2025</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Introduction</h2>
            <p className="text-dark-300 leading-relaxed">
              Peja ("we", "our", or "us") is committed to protecting your privacy. 
              This Privacy Policy explains how we collect, use, and safeguard your 
              information when you use our mobile application and services.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Information We Collect</h2>
            <div className="text-dark-300 leading-relaxed space-y-4">
              <div>
                <h3 className="text-lg font-medium text-dark-200 mb-2">Personal Information</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Full name</li>
                  <li>Email address</li>
                  <li>Phone number</li>
                  <li>Date of birth</li>
                  <li>Occupation (optional)</li>
                  <li>Profile photo (optional)</li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-medium text-dark-200 mb-2">Location Data</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>GPS coordinates when posting incidents</li>
                  <li>Location for receiving nearby alerts</li>
                  <li>Saved locations (home, work, etc.)</li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-medium text-dark-200 mb-2">Usage Data</h3>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Posts and confirmations</li>
                  <li>App interactions and preferences</li>
                  <li>Device information</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2 text-dark-300">
              <li>To provide and maintain our service</li>
              <li>To send you relevant safety alerts based on your location</li>
              <li>To verify your identity and prevent fraud</li>
              <li>To improve our services</li>
              <li>To communicate with you about updates</li>
              <li>To ensure community safety and accountability</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Anonymous Posting</h2>
            <div className="p-4 glass-sm rounded-xl">
              <p className="text-dark-300 leading-relaxed">
                <strong className="text-dark-100">Important:</strong> Your identity is hidden from other users. 
                However, Peja administrators can always see your identity for safety and accountability purposes. 
                This helps us maintain trust and prevent abuse.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Data Sharing</h2>
            <div className="text-dark-300 leading-relaxed space-y-2">
              <p>We may share your information with:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Law Enforcement:</strong> When required by law or to protect safety</li>
                <li><strong>Emergency Services:</strong> During SOS alerts</li>
                <li><strong>Service Providers:</strong> Who help us operate our service</li>
              </ul>
              <p className="mt-4">
                <strong className="text-green-400">We DO NOT sell your personal data to advertisers or third parties.</strong>
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Data Security</h2>
            <p className="text-dark-300 leading-relaxed">
              We implement appropriate security measures to protect your data, including:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-dark-300 mt-2">
              <li>Encryption of data in transit and at rest</li>
              <li>Secure password hashing</li>
              <li>Regular security audits</li>
              <li>Access controls for staff</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Your Rights</h2>
            <p className="text-dark-300 leading-relaxed">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2 text-dark-300 mt-2">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and data</li>
              <li>Export your data</li>
              <li>Opt out of non-essential communications</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Data Retention</h2>
            <p className="text-dark-300 leading-relaxed">
              We retain your data for as long as your account is active. Incident posts 
              are archived after resolution but remain searchable for community safety. 
              You can request deletion of your account at any time.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Children's Privacy</h2>
            <p className="text-dark-300 leading-relaxed">
              Peja is not intended for users under 13 years of age. We do not knowingly 
              collect information from children under 13.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">Contact Us</h2>
            <p className="text-dark-300 leading-relaxed">
              For privacy-related questions or requests, contact us at:
              <br />
              <a href="mailto:pejastudios@gmail.com" className="text-primary-400 hover:underline">
                pejastudios@gmail.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}