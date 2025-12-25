"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
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
          <h1 className="text-lg font-semibold text-dark-100">Terms of Service</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4 py-6">
        <div className="prose prose-invert max-w-none">
          <p className="text-dark-400 text-sm mb-6">Last updated: December 2025</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">1. Acceptance of Terms</h2>
            <p className="text-dark-300 leading-relaxed">
              By accessing or using Peja, you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">2. Description of Service</h2>
            <p className="text-dark-300 leading-relaxed">
              Peja is a community safety platform that allows users to report and receive 
              alerts about incidents in their area. The service is provided "as is" and 
              we make no warranties about the accuracy or timeliness of reports.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">3. User Responsibilities</h2>
            <div className="text-dark-300 leading-relaxed space-y-2">
              <p>As a user of Peja, you agree to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Only post accurate and truthful information about incidents</li>
                <li>Not post false reports or hoaxes</li>
                <li>Not use the service for illegal purposes</li>
                <li>Not harass or threaten other users</li>
                <li>Not upload inappropriate, explicit, or harmful content</li>
                <li>Respect the privacy of others</li>
              </ul>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">4. Prohibited Conduct</h2>
            <div className="text-dark-300 leading-relaxed space-y-2">
              <p>The following actions are strictly prohibited and will result in account termination:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className="text-red-400">False Reports:</strong> Posting fake incidents will result in immediate ban</li>
                <li><strong className="text-red-400">SOS Abuse:</strong> Misusing the emergency SOS feature will result in permanent ban</li>
                <li><strong className="text-red-400">Harassment:</strong> Targeting or threatening other users</li>
                <li><strong className="text-red-400">Spam:</strong> Posting repetitive or promotional content</li>
              </ul>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">5. Content Ownership</h2>
            <p className="text-dark-300 leading-relaxed">
              You retain ownership of content you post. However, by posting on Peja, you 
              grant us a license to use, display, and distribute your content for the 
              purpose of operating the service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">6. Anonymity</h2>
            <p className="text-dark-300 leading-relaxed">
              While you may choose to post anonymously, your identity is always visible 
              to Peja administrators for safety and accountability purposes. We may 
              disclose your information to law enforcement if required.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">7. Limitation of Liability</h2>
            <p className="text-dark-300 leading-relaxed">
              Peja is not responsible for actions taken based on user-submitted reports. 
              Always verify information independently and contact official emergency 
              services (Police, Fire, Ambulance) for emergencies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">8. Account Termination</h2>
            <p className="text-dark-300 leading-relaxed">
              We reserve the right to suspend or terminate accounts that violate these 
              terms without prior notice. You may also delete your account at any time 
              through the app settings.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">9. Changes to Terms</h2>
            <p className="text-dark-300 leading-relaxed">
              We may update these terms from time to time. Continued use of the service 
              after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section className="mb-8">
  <h2 className="text-xl font-semibold text-dark-100 mb-3">10. Emergency Response Disclaimer</h2>
  <div className="text-dark-300 leading-relaxed space-y-4">
    <p>
      Peja is a community-driven platform designed to facilitate communication and awareness 
      about incidents in your area. <strong className="text-dark-100">Peja is not an emergency service</strong> and 
      should not be used as a substitute for official emergency services such as the Nigeria 
      Police Force, Fire Service, or medical emergency responders.
    </p>
    
    <div className="p-4 glass-sm rounded-xl border border-orange-500/30">
      <p className="font-semibold text-orange-400 mb-2">Important Safety Notice</p>
      <ul className="list-disc pl-6 space-y-2 text-dark-300">
        <li>
          When responding to any SOS alert or incident report, <strong className="text-dark-100">your personal safety 
          is your sole responsibility</strong>. We strongly advise you to assess all situations carefully 
          before taking any action.
        </li>
        <li>
          Do not approach situations involving armed individuals, violence, or any scenario 
          where your safety may be at risk. Contact official emergency services instead.
        </li>
        <li>
          The "I Can Help" feature is intended for situations where you can safely provide 
          assistance. Clicking this button is a voluntary choice made entirely at your own discretion.
        </li>
        <li>
          Peja, its operators, employees, and affiliates <strong className="text-dark-100">shall not be held liable</strong> for 
          any injury, harm, loss, or damage - including but not limited to physical injury, 
          property damage, emotional distress, or death - that may occur as a result of your 
          decision to respond to or engage with any alert, SOS, or incident reported on this platform.
        </li>
      </ul>
    </div>

    <p>
      By using Peja, you acknowledge and accept that:
    </p>
    <ul className="list-disc pl-6 space-y-2">
      <li>
        All decisions to respond to incidents are made voluntarily and at your own risk.
      </li>
      <li>
        Peja does not verify the accuracy, legitimacy, or safety of user-submitted reports in real-time.
      </li>
      <li>
        We do not dispatch emergency responders or guarantee any response to alerts.
      </li>
      <li>
        You are solely responsible for your actions and their consequences when using this platform.
      </li>
      <li>
        In any emergency situation, you should always contact official emergency services 
        (Police: 112, 767 | Fire: 112 | Ambulance: 112) as your first course of action.
      </li>
    </ul>

    <p>
      While we encourage community solidarity and mutual assistance, we urge all users to 
      prioritize their own safety above all else. No act of help is worth risking your life. 
      If you cannot safely assist, please alert others who may be better positioned to help 
      or contact the appropriate authorities.
    </p>
  </div>
</section>

<section className="mb-8">
  <h2 className="text-xl font-semibold text-dark-100 mb-3">11. Indemnification</h2>
  <p className="text-dark-300 leading-relaxed">
    You agree to indemnify, defend, and hold harmless Peja, its parent company, officers, 
    directors, employees, agents, and affiliates from and against any and all claims, damages, 
    obligations, losses, liabilities, costs, and expenses (including but not limited to 
    attorney's fees) arising from: (i) your use of and access to the Service; (ii) your 
    violation of any term of these Terms of Service; (iii) your violation of any third-party 
    right, including without limitation any privacy right or intellectual property right; 
    (iv) any claim that your actions caused damage to a third party; or (v) your response 
    to any SOS alert, incident report, or emergency situation communicated through the platform.
  </p>
</section>

<section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">12. Contact Us</h2>
            <p className="text-dark-300 leading-relaxed">
              If you have questions about these terms, contact us at:
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

