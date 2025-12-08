"use client";

import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  Shield,
  MessageCircle,
} from "lucide-react";

export default function GuardianGuidelinesPage() {
  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-dark-100">Guardian Guidelines</h1>
        <p className="text-dark-400 mt-1">Reference for content moderation decisions</p>
      </div>

      <div className="space-y-6">
        {/* What Guardians Do */}
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary-400" />
            Your Role as a Guardian
          </h2>
          <ul className="space-y-3 text-dark-300">
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-400 mt-1 flex-shrink-0" />
              Review flagged content for community guideline violations
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-400 mt-1 flex-shrink-0" />
              Approve legitimate incident reports
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-400 mt-1 flex-shrink-0" />
              Add blur/warning to sensitive but legitimate content
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-400 mt-1 flex-shrink-0" />
              Remove content that violates guidelines
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-400 mt-1 flex-shrink-0" />
              Escalate complex cases to Admin
            </li>
          </ul>
        </div>

        {/* Approval Guidelines */}
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            When to Approve
          </h2>
          <ul className="space-y-2 text-dark-300">
            <li>• Content appears to be a genuine incident report</li>
            <li>• No explicit violations of community guidelines</li>
            <li>• The flag appears to be a mistake or misunderstanding</li>
            <li>• Content is newsworthy and serves public interest</li>
            <li>• Graphic content is relevant to the incident (add blur)</li>
          </ul>
        </div>

        {/* Blur Guidelines */}
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5 text-yellow-400" />
            When to Add Blur
          </h2>
          <ul className="space-y-2 text-dark-300">
            <li>• Accident scenes with visible injuries</li>
            <li>• Fire or disaster scenes that may be disturbing</li>
            <li>• Crime scenes with blood or violence</li>
            <li>• Content that is legitimate but may upset sensitive viewers</li>
            <li>• Dead animals or wildlife incidents</li>
          </ul>
          <p className="mt-3 text-sm text-dark-500">
            Adding blur keeps the content accessible while protecting sensitive viewers.
          </p>
        </div>

        {/* Removal Guidelines */}
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-400" />
            When to Remove
          </h2>
          <ul className="space-y-2 text-dark-300">
            <li>• Pornography or explicit sexual content</li>
            <li>• Fake or intentionally false reports</li>
            <li>• Spam or promotional content</li>
            <li>• Content targeting/harassing individuals</li>
            <li>• Extreme violence not related to safety reporting</li>
            <li>• Content promoting illegal activities</li>
            <li>• Duplicate reports (if exact copy)</li>
          </ul>
        </div>

        {/* Escalation Guidelines */}
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            When to Escalate
          </h2>
          <ul className="space-y-2 text-dark-300">
            <li>• Content involving minors in any concerning way</li>
            <li>• Threats of violence or terrorism</li>
            <li>• Content requiring legal review</li>
            <li>• Repeat offenders who may need banning</li>
            <li>• Content you're unsure about</li>
            <li>• Technical issues preventing proper review</li>
          </ul>
          <p className="mt-3 text-sm text-primary-400">
            When in doubt, escalate. It's better to be cautious.
          </p>
        </div>

        {/* What You Cannot Do */}
        <div className="glass-card border border-red-500/30">
          <h2 className="text-lg font-semibold text-red-400 mb-4">
            What Guardians Cannot Do
          </h2>
          <ul className="space-y-2 text-dark-300">
            <li>• Access users' personal information (email, phone, exact location)</li>
            <li>• Ban or suspend users (escalate to Admin)</li>
            <li>• Modify or edit content</li>
            <li>• Contact users directly</li>
            <li>• Share flagged content outside Peja</li>
            <li>• Make moderation decisions based on personal bias</li>
          </ul>
        </div>

        {/* Tips */}
        <div className="glass-card bg-primary-500/10 border border-primary-500/30">
          <h2 className="text-lg font-semibold text-primary-400 mb-4 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            Tips for Effective Moderation
          </h2>
          <ul className="space-y-2 text-dark-300">
            <li>• Review context — check the category and location</li>
            <li>• Consider intent — was this an honest report or abuse?</li>
            <li>• Be consistent — apply the same standards to all content</li>
            <li>• Take breaks — moderation fatigue is real</li>
            <li>• Ask for help — reach out if you're struggling with decisions</li>
          </ul>
        </div>
      </div>
    </div>
  );
}