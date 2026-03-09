interface Props {
  title: string;
  description: string;
  imageFile: File | null;
}

export default function PepsiChatPreview({ title, description, imageFile }: Props) {
  const imageUrl = imageFile ? URL.createObjectURL(imageFile) : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden max-w-xs mx-auto shadow-sm">
      {/* Chat header */}
      <div className="relative">
        {imageUrl ? (
          <img src={imageUrl} alt="preview" className="w-full h-36 object-cover" />
        ) : (
          <div className="w-full h-36 bg-gray-100 flex items-center justify-center text-gray-300 text-3xl">
            🖼️
          </div>
        )}
        <div className="absolute inset-0 flex items-start justify-between p-2">
          <button className="w-7 h-7 rounded-full bg-white/80 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-1 bg-white/90 rounded-full px-2 py-1">
            <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-xs font-medium text-gray-700">Cupón válido</span>
          </div>
        </div>
      </div>

      {/* Logo */}
      <div className="flex justify-center -mt-5 relative z-10">
        <div className="w-10 h-10 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center shadow">
          <div className="w-7 h-7 rounded-full bg-blue-800 flex items-center justify-center">
            <span className="text-white text-xs font-bold">P</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 pt-1">
        <h3 className="text-center font-semibold text-gray-900 text-base leading-tight mb-2">
          {title || "Titulo de la campaña"}
        </h3>

        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <span>🟡</span> Ganas <strong>x puntos</strong>
          </span>
          <span className="flex items-center gap-1 text-xs text-blue-500">
            <span>🕐</span> Quedan <strong>x días</strong>
          </span>
        </div>

        <p className="text-center text-xs text-gray-600 mb-3">
          {description || "Texto de la promoción"}
        </p>

        <div className="bg-gray-50 rounded-lg p-3 space-y-2 mb-4">
          <div className="flex items-start gap-1.5 text-xs text-gray-600">
            <span className="text-red-500 mt-0.5">🔴</span>
            <span>Aplica únicamente en productos participantes.</span>
          </div>
          <div className="flex items-start gap-1.5 text-xs text-gray-600">
            <span className="text-red-500 mt-0.5">🔴</span>
            <span>Promoción válida hasta [fecha límite] o hasta agotar stock.</span>
          </div>
        </div>

        <button className="w-full bg-blue-700 text-white text-sm font-medium py-2.5 rounded-full mb-2">
          Aceptar canje
        </button>
        <button className="w-full border border-gray-300 text-gray-600 text-sm font-medium py-2.5 rounded-full">
          Volver
        </button>
      </div>
    </div>
  );
}
