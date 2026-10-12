"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";

export default function TermsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen pb-20">
      <Header variant="back" title="Terms of Service" onBack={() => router.back()} />

      <main className="pt-app-header-pill max-w-2xl mx-auto px-4 py-6">
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
            <p className="text-dark-300 leading-relaxed mt-3">
              As a safety measure, while the app is open and you have granted location
              permission, Peja keeps your most recent location up to date so that emergency
              responders or administrators may locate you if you are unable to trigger an SOS
              or Share My Location yourself. This stops when you close the app. By using the
              service you consent to this use of your location.
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
              While you may post anonymously, your identity is always visible 
              to Peja administrators for safety and accountability purposes. We may 
              disclose your information to law enforcement and/or other services if required.
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
            <h2 className="text-xl font-semibold text-dark-100 mb-3">8. Location Accuracy and Availability</h2>
            <p className="text-dark-300 leading-relaxed">
              Peja makes its best effort to determine and share your location as accurately
              as possible, using GPS and the other positioning signals your device provides.
              However, location accuracy depends on factors outside our control, including your
              device, GPS signal, network coverage, weather, buildings, and your surroundings.
              In some areas or conditions a precise position simply cannot be obtained.
            </p>
            <p className="text-dark-300 leading-relaxed mt-3">
              Because of this, peja does not guarantee that any location shown is exact,
              current, or available at all times. A location may be approximate, delayed, or
              unavailable, and we label how fresh or rough a position is wherever we can. Live
              location updates require the app to be open and running; when the app is closed
              or the device is offline, your circle sees your last known position, not a live one.
            </p>
            <p className="text-dark-300 leading-relaxed mt-3">
              You should treat any location as a guide, not a precise or guaranteed fix, and
              never rely on it alone in an emergency. Peja is not liable for any loss, harm, or
              decision resulting from location that is inaccurate, delayed, approximate, or
              unavailable.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">9. Account Termination</h2>
            <p className="text-dark-300 leading-relaxed">
              We reserve the right to suspend or terminate accounts that violate these 
              terms without prior notice. You may also delete your account at any time 
              through the app settings.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">10. Changes to Terms</h2>
            <p className="text-dark-300 leading-relaxed">
              We may update these terms from time to time. Continued use of the service 
              after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section className="mb-8">
  <h2 className="text-xl font-semibold text-dark-100 mb-3">11. Emergency Response Disclaimer</h2>
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
  <h2 className="text-xl font-semibold text-dark-100 mb-3">12. Indemnification</h2>
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
            <h2 className="text-xl font-semibold text-dark-100 mb-3">13. Advertising on Peja</h2>
            <div className="text-dark-300 leading-relaxed space-y-4">
              <p>
                Peja carries paid placements from local businesses. Every one of
                them is labelled &quot;Sponsored&quot;. If it is not labelled, it is not
                an advert.
              </p>
              <p>
                <strong className="text-dark-100">We limit how much you see.</strong>{" "}
                No more than two sponsored pins appear on the map at any time, no
                matter how many businesses have paid. Sponsored results in search
                are marked and sit alongside ordinary results, never in place of
                them.
              </p>
              <p>
                <strong className="text-dark-100">Adverts stop during emergencies.</strong>{" "}
                While an SOS is active, or while there is a live incident reported
                near you, sponsored placements are hidden. Safety information is
                never competing for space with an advert.
              </p>
              <p>
                <strong className="text-dark-100">We do not sell your data.</strong>{" "}
                Advertisers do not receive your name, your location, your phone
                number or anything else about you. They see counts: how many times
                their placement was shown and how many times it was tapped. Nothing
                that identifies a person ever reaches an advertiser.
              </p>
              <p>
                We refuse categories of advertising that we believe do not belong
                on a safety app, including betting and gambling, loan and quick
                cash apps, investment and crypto schemes, unlicensed health claims,
                and political campaigning. The full list is in section 14.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">14. Terms for Advertisers</h2>
            <div className="text-dark-300 leading-relaxed space-y-4">
              <p>
                This section applies if you buy a placement on Peja. It is in
                addition to the rest of these terms.
              </p>
              <p>
                You must be 18 or over to buy a placement, and you must be
                authorised to act for the business you are advertising.
              </p>

              <p className="text-dark-100 font-semibold">What you are buying</p>
              <p>
                You are buying a <em>placement</em>: a position on the map, in
                search, or in the carousel, for the period you have paid for. You
                are not buying a number of views, impressions, taps or customers,
                and none of those are guaranteed.
              </p>
              <p>
                Where we show an estimated area population, that figure is the
                population of the local government area, derived from the 2006
                national census and projected forward at the national growth rate.
                It describes the size of the area. It is not a count of Peja users
                and it is not a forecast of how many people will see your
                placement. Not reaching a number of views is not grounds for a
                refund.
              </p>

              <p className="text-dark-100 font-semibold">What we will not carry</p>
              <p>
                We do not accept advertising for: betting, gambling, lottery or
                casino services; loan apps, moneylending or quick cash; crypto,
                forex or anything promising investment returns; unlicensed health
                claims, herbal cures or unapproved drugs; spiritual or miracle
                services charging money; multi-level or network marketing; weapons;
                tobacco and vaping; adult content; political parties, candidates or
                campaigns.
              </p>
              <p>
                Every submission is reviewed by a person before it goes live. We
                may reject or remove any placement at any time.
              </p>
              <p>
                If we remove a live placement because it broke these terms,
                misrepresented your business, or drew complaints we judge to be well
                founded, no refund or credit is due and the money already paid is
                not returned.
              </p>
              <p>
                If we remove it for our own reasons, or it fails to run because of a
                fault on our side, we credit you for the days it did not run.
              </p>

              <p className="text-dark-100 font-semibold">Payment and renewal</p>
              <p>
                Payments are handled by Paystack. Peja never sees or stores your
                card number. When you pay, Paystack keeps your card and gives us a
                reference to it, which is what lets each month renew without asking
                you for the card again. You can stop that at any time, and once you
                have, we cannot charge the card.
              </p>
              <p>
                Placements are billed monthly and renew automatically. We notify you
                three days before each charge, and you can cancel at any time. A
                cancellation takes effect at the end of the period you have already
                paid for.
              </p>
              <p>
                If a payment fails, your placement keeps running for three days
                while we retry. On the fourth day it is hidden but your slot is
                held. If payment has not succeeded after seven days, the slot is
                released. Where another business is waiting for that slot, it may be
                released as soon as your placement is hidden.
              </p>

              <p className="text-dark-100 font-semibold">Refunds</p>
              <p>
                You may cancel for a full refund at any point before your placement
                goes live. Once it is live, the period you have used is not
                refundable.
              </p>
              <p>
                If a renewal charges you by mistake, tell us within 24 hours and we
                will refund it in full.
              </p>
              <p>
                <strong className="text-dark-100">Come to us before your bank.</strong>{" "}
                If a charge looks wrong, tell us and we will sort it out, usually the
                same day. Asking your bank to reverse a payment without contacting us
                first costs us a fee whether or not the claim is upheld, and gives us
                hours to respond to something you could have raised with us directly.
                We may suspend or decline future placements for an account that does
                this rather than coming to us.
              </p>
              <p>
                <strong className="text-dark-100">What &quot;credit&quot; means.</strong>{" "}
                Where these terms say we credit you, we mean we extend your
                placement by the number of days it did not run, or hold the value
                against a future placement. Credit is not paid out as cash.
              </p>

              <p className="text-dark-100 font-semibold">Stopping an advert</p>
              <p>
                Each placement is managed on its own. Pausing, stopping or
                removing one never affects any other advert you are running.
              </p>
              <p>
                <strong className="text-dark-100">Pause</strong> hides the
                advert and stops the next renewal. The period you have already
                paid for keeps running, so you can put it back up at any time
                before that period ends.{" "}
                <strong className="text-dark-100">Stop renewing</strong> leaves
                it running to the end of that period and then ends it, with no
                further charge.{" "}
                <strong className="text-dark-100">Take it down</strong> removes
                it immediately. Because that ends the period early by your own
                choice, the remainder is not refunded.
              </p>
              <p>
                An advert that has been submitted but not yet approved can be
                withdrawn at any time for a full refund, as above. Once it is
                approved and running, the period used is not refundable.
              </p>

              <p className="text-dark-100 font-semibold">The waiting list</p>
              <p>
                Every area has a limit on how many placements it can carry at each
                tier, so that the people using Peja are not shown a map covered in
                adverts and so that what you buy is actually seen. Featured is the
                tightest and will usually be the one that fills.
              </p>
              <p>
                Where an area is sold out at the tier you want, you can join a
                waiting list by paying a deposit of 25 percent of the price. That deposit is fully refundable
                at any time before the balance is taken. When a slot becomes
                available we tell you 24 hours before charging the balance to your
                card, and you can cancel in that window. If the charge fails you
                have a further 24 hours to resolve it, extended while nobody else is
                waiting, to a maximum of seven days.
              </p>

              <p className="text-dark-100 font-semibold">Your content</p>
              <p>
                You keep ownership of your logo, name and text. You confirm that you
                have the right to use them and that what you tell us about your
                business is true. You give us permission to display them within Peja
                for the period of your placement.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-dark-100 mb-3">15. Contact Us</h2>
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

