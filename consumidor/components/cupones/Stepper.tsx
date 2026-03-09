const steps = ["Mundo Pepsi", "Pepsi Chat", "Configuración", "Asignación"];

export default function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {steps.map((step, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;

        return (
          <div key={step} className="flex items-center">
            {/* Step */}
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-purple-600 text-white"
                    : isDone
                    ? "bg-purple-200 text-purple-700"
                    : "border-2 border-gray-300 text-gray-400 bg-white"
                }`}
              >
                {stepNum}
              </div>
              <span
                className={`text-sm whitespace-nowrap ${
                  isActive
                    ? "font-semibold text-gray-900"
                    : isDone
                    ? "text-purple-600"
                    : "text-gray-400"
                }`}
              >
                {step}
              </span>
            </div>

            {/* Connector */}
            {idx < steps.length - 1 && (
              <div className="w-24 mx-2 border-t-2 border-dashed border-gray-300" />
            )}
          </div>
        );
      })}
    </div>
  );
}
