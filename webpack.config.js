const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const BundleAnalyzerPlugin =
	require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");

// Load environment variables from .env file
require("dotenv").config();

module.exports = (env, argv) => {
	const isProduction = argv.mode === "production";
	const isFast = env && env.fast;

	return {
		target: "electron-renderer",
		// Ensure Node built-ins are not externalized; we want browser polyfills
		externalsPresets: {
			node: false,
			electron: false,
			electronRenderer: false,
			web: true,
		},
		externals: [],
		experiments: {
			asyncWebAssembly: true,
		},
		entry: {
			main: "./src/renderer/index.tsx",
		},
		output: {
			path: path.resolve(__dirname, "dist"),
			filename: isProduction ? "[name].[fullhash].js" : "[name].js",
			publicPath: "./",
			clean: {
				keep: /main\//,
			},
		},
		module: {
			rules: [
				{
					test: /\.m?js$/,
					resolve: {
						fullySpecified: false,
					},
				},
				{
					test: /\.tsx?$/,
					use: "ts-loader",
					exclude: /node_modules/,
				},
				{
					test: /\.css$/,
					use: ["style-loader", "css-loader"],
				},
				{
					test: /\.(png|jpg|jpeg|gif|svg)$/,
					type: "asset/resource",
					parser: {
						dataUrlCondition: {
							maxSize: 8 * 1024, // 8kb
						},
					},
				},
				{
					test: /\.wasm$/,
					type: "asset/resource",
				},
			],
		},
		resolve: {
			extensions: [".tsx", ".ts", ".js"],
			mainFields: ["browser", "module", "main"],
			alias: {
				"@components": path.resolve(__dirname, "src/renderer/components"),
				undici: false,
			},
			// Prefer browser conditions when resolving package exports
			conditionNames: ["webpack", "browser", "import", "module", "default"],
			fallback: {
				path: false,
				fs: false,
				os: false,
				net: false,
				child_process: false,
				util: false,
				ws: false,
				crypto: false,
				stream: false,
				buffer: require.resolve("buffer/"),
				process: false,
				url: false,
				querystring: false,
				http: false,
				https: false,
				zlib: false,
				assert: false,
				constants: false,
				domain: false,
				events: false,
				punycode: false,
				string_decoder: false,
				sys: false,
				timers: false,
				tty: false,
				vm: false,
			},
		},
		plugins: [
			new HtmlWebpackPlugin({
				template: "./src/renderer/index.html",
				filename: "index.html",
			}),
			new CopyWebpackPlugin({
				patterns: [
					{
						from: "src/png/axon-apple-120.png",
						to: "png/axon-apple-120.png",
					},
					{
						from: "src/png/axon-no-background.png",
						to: "png/axon-no-background.png",
					},
				],
			}),
			// Add bundle analyzer in production or when --analyze flag is used
			...(env.analyze ? [new BundleAnalyzerPlugin()] : []),
			// Add Node.js polyfills for browser compatibility
			new NodePolyfillPlugin(),
			// Add global polyfill for Node.js compatibility
			new (require("webpack").DefinePlugin)({
				global: "window",
				"process.env.BACKEND_URL": JSON.stringify(
					process.env.BACKEND_URL || ""
				),
				"process.env.FIREBASE_API_KEY": JSON.stringify(
					process.env.FIREBASE_API_KEY || ""
				),
				"process.env.FIREBASE_AUTH_DOMAIN": JSON.stringify(
					process.env.FIREBASE_AUTH_DOMAIN || ""
				),
				"process.env.FIREBASE_PROJECT_ID": JSON.stringify(
					process.env.FIREBASE_PROJECT_ID || ""
				),
				"process.env.FIREBASE_APP_ID": JSON.stringify(
					process.env.FIREBASE_APP_ID || ""
				),
			}),
			new (require("webpack").ProvidePlugin)({
				Buffer: ["buffer", "Buffer"],
			}),
		],
		devtool: isProduction ? false : isFast ? "eval-cheap-module-source-map" : "source-map",
		optimization: {
			usedExports: true,
			sideEffects: false,
			providedExports: true,
			innerGraph: true,
			mangleExports: isProduction,
			splitChunks: isFast ? false : {
				chunks: "all",
				minSize: 20000,
				maxSize: 250000,
				cacheGroups: {
					vendor: {
						test: /[\\/]node_modules[\\/]/,
						name: "vendors",
						chunks: "all",
						priority: 1,
					},
					monaco: {
						test: /[\\/]node_modules[\\/]@monaco-editor[\\/]/,
						name: "monaco",
						chunks: "all",
						priority: 20,
					},
					react: {
						test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
						name: "react",
						chunks: "all",
						priority: 15,
					},
					lodash: {
						test: /[\\/]node_modules[\\/]lodash[\\/]/,
						name: "lodash",
						chunks: "all",
						priority: 10,
					},
				},
			},
		},
		performance: {
			hints: isProduction ? "warning" : false,
			maxEntrypointSize: 5000000,
			maxAssetSize: 5000000,
		},
	};
};
