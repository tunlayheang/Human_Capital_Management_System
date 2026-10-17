export default {
  plugins: {
    tailwindcss: {},
    'postcss-preset-env': {
      stage: 2,
      features: {
        'custom-properties': false,
        'nesting-rules': false,
      },
    },
    autoprefixer: {},
  },
}
