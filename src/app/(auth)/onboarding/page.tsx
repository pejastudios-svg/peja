"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Calendar, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const GUIDELINES = [
  "Only post real incidents",
  "No false alarms (results in ban)",
  "No explicit or inappropriate content",
  "Respect others' privacy",
  "Help your community stay safe",
];

const QUIZ_QUESTIONS = [
  {
    question: "Can you post fake incidents for fun?",
    options: ["Yes", "No"],
    correct: 1,
  },
  {
    question: "What happens if you abuse the SOS feature?",
    options: ["Nothing", "Permanent ban"],
    correct: 1,
  },
  {
    question: "Should you verify an incident before confirming it?",
    options: ["Yes", "No"],
    correct: 0,
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [step, setStep] = useState(1);
  const [occupation, setOccupation] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [quizAnswers, setQuizAnswers] = useState<number[]>([-1, -1, -1]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleQuizAnswer = (questionIndex: number, answerIndex: number) => {
    const newAnswers = [...quizAnswers];
    newAnswers[questionIndex] = answerIndex;
    setQuizAnswers(newAnswers);
  };

  const isQuizCorrect = () => {
    return QUIZ_QUESTIONS.every((q, i) => quizAnswers[i] === q.correct);
  };

  const handleComplete = async () => {
    if (!isQuizCorrect()) {
      setError("Some answers are incorrect. Please review the guidelines.");
      return;
    }

    setLoading(true);
    setError("");

    if (user) {
      const { error: updateError } = await supabase
        .from("users")
        .update({
          occupation,
          date_of_birth: dateOfBirth,
        })
        .eq("id", user.id);

      if (updateError) {
        setError("Failed to save profile. Please try again.");
        setLoading(false);
        return;
      }
    }

    router.push("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-3xl">P</span>
          </div>
          <h1 className="text-2xl font-bold text-dark-50">
            {step === 1 ? "Complete Your Profile" : "Community Guidelines"}
          </h1>
          <p className="text-dark-400 mt-2">
            {step === 1 ? "Just a few more details" : "Please read and confirm"}
          </p>

          <div className="flex justify-center gap-2 mt-4">
            <div className={`w-8 h-1 rounded-full ${step >= 1 ? "bg-primary-600" : "bg-dark-700"}`} />
            <div className={`w-8 h-1 rounded-full ${step >= 2 ? "bg-primary-600" : "bg-dark-700"}`} />
          </div>
        </div>

        <div className="glass-card">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Input
                type="text"
                label="Occupation"
                placeholder="What do you do?"
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                leftIcon={<Briefcase className="w-4 h-4" />}
              />

              <Input
                type="date"
                label="Date of Birth"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                leftIcon={<Calendar className="w-4 h-4" />}
              />

              <Button
                variant="primary"
                className="w-full mt-6"
                onClick={() => setStep(2)}
              >
                Continue
              </Button>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="mb-6">
                <h3 className="text-sm font-medium text-dark-200 mb-3">
                  By using Peja, you agree to:
                </h3>
                <ul className="space-y-2">
                  {GUIDELINES.map((guideline, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-dark-300">
                      <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                      {guideline}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-white/5 pt-6">
                <h3 className="text-sm font-medium text-dark-200 mb-4">Quick Quiz</h3>
                <div className="space-y-4">
                  {QUIZ_QUESTIONS.map((q, qIndex) => (
                    <div key={qIndex}>
                      <p className="text-sm text-dark-300 mb-2">{q.question}</p>
                      <div className="flex gap-2">
                        {q.options.map((option, oIndex) => (
                          <button
                            key={oIndex}
                            onClick={() => handleQuizAnswer(qIndex, oIndex)}
                            className={`flex-1 py-2 px-3 rounded-lg text-sm transition-all ${
                              quizAnswers[qIndex] === oIndex
                                ? "bg-primary-600 text-white"
                                : "glass-sm text-dark-300 hover:bg-white/10"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                variant="primary"
                className="w-full mt-6"
                onClick={handleComplete}
                isLoading={loading}
              >
                Complete Setup
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}