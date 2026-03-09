interface Props {
  title: string;
  description: string;
  imageFile: File | null;
}

export default function MundoPepsiPreview({ title, description, imageFile }: Props) {
  const imageUrl = imageFile ? URL.createObjectURL(imageFile) : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 max-w-xs mx-auto">
      {/* App header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full bg-blue-800 flex items-center justify-center">
          <span className="text-white text-xs font-bold">P</span>
        </div>
        <span className="text-xs font-semibold text-gray-700">Pepsi Cupones</span>
      </div>

      {/* Image */}
      <div className="w-full h-36 rounded-lg bg-gray-100 overflow-hidden mb-3 flex items-center justify-center">
        {imageUrl ? (
          <img src={imageUrl} alt="preview" className="w-full h-full object-cover" />
        ) : (
          <div className="text-gray-300 text-3xl">🖼️</div>
        )}
      </div>

      {/* Logo badge */}
      <div className="flex justify-center -mt-6 mb-2 relative z-10">
        <div className="w-10 h-10 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center shadow">
          <div className="w-7 h-7 rounded-full bg-blue-800 flex items-center justify-center">
            <span className="text-white text-xs font-bold">P</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="text-center px-2">
        <h3 className="font-black text-gray-900 uppercase text-sm leading-tight mb-2">
          {title || "TITULO DE LA CAMPAÑA"}
        </h3>
        <div className="w-full h-px bg-gray-200 mb-2" />
        <p className="text-xs text-gray-600 mb-3">{description || "Texto de la promoción"}</p>

        <div className="text-left space-y-1.5 text-xs text-gray-600 mb-4">
          <div className="flex items-start gap-1.5">
            <span className="text-red-500 mt-0.5">🔴</span>
            <span>Aplica únicamente en productos participantes.</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="text-red-500 mt-0.5">🔴</span>
            <span>Promoción válida hasta [fecha límite] o mientras haya existencias.</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="text-red-500 mt-0.5">🔴</span>
            <span>No es acumulable con otras promos ni descuentos.</span>
          </div>
        </div>

        <button className="w-full bg-blue-700 text-white text-sm font-medium py-2.5 rounded-full">
          Canjear cupón
        </button>
      </div>
    </div>
  );
}
