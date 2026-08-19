// prisma/migrate/local_db_backup.js
const { MongoClient } = require('mongodb');

// Connection Strings - مستقیماً داخل اسکریپت
const LOCAL_URI = "mongodb://127.0.0.1:27017";
const ATLAS_URI = "mongodb://uniqu434343:MirAli%40434343%2A@megancluster-shard-00-00.jm46r.mongodb.net:27017,megancluster-shard-00-01.jm46r.mongodb.net:27017,megancluster-shard-00-02.jm46r.mongodb.net:27017/daymat_online_db?ssl=true&replicaSet=atlas-10bcqm-shard-0&authSource=admin&appName=MeganCluster";

console.log('🔍 Debug: ATLAS_URI =', ATLAS_URI.substring(0, 50) + '...');
console.log('🔍 Debug: LOCAL_URI =', LOCAL_URI);
console.log('');

async function migrate() {
    console.log('🚀 Starting migration...\n');
    console.log('='.repeat(60));
    console.log('📋 Local DB: sarnakh_db');
    console.log('📋 Atlas DB: sarnakh_online_db');
    console.log('='.repeat(60));

    const localClient = new MongoClient(LOCAL_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
    });

    const atlasClient = new MongoClient(ATLAS_URI, {
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
    });

    try {
        console.log('\n⏳ Connecting to local MongoDB...');
        await localClient.connect();
        console.log('✅ Connected to local MongoDB');

        console.log('⏳ Connecting to MongoDB Atlas...');
        await atlasClient.connect();
        console.log('✅ Connected to MongoDB Atlas\n');

        const localDb = localClient.db("daymat_db");
        const atlasDb = atlasClient.db("daymat_online_db");

        const collections = await localDb.listCollections().toArray();
        console.log(`📦 Found ${collections.length} collections to migrate\n`);

        let totalMigrated = 0;
        let failedCollections = [];

        for (const collection of collections) {
            const collectionName = collection.name;
            console.log(`\n📦 Migrating: ${collectionName}`);
            console.log('-'.repeat(40));

            try {
                const documents = await localDb.collection(collectionName).find({}).toArray();
                console.log(`   📄 Documents found: ${documents.length}`);

                if (documents.length > 0) {
                    console.log(`   🔍 First _id: ${documents[0]._id}`);
                    console.log(`   🔍 Last _id: ${documents[documents.length - 1]._id}`);

                    const deleteResult = await atlasDb.collection(collectionName).deleteMany({});
                    console.log(`   🗑️  Deleted ${deleteResult.deletedCount} existing documents from Atlas`);

                    const result = await atlasDb.collection(collectionName).insertMany(documents);
                    console.log(`   ✅ Inserted ${result.insertedCount} documents`);
                    totalMigrated += result.insertedCount;
                } else {
                    console.log(`   ⚠️  Empty collection, skipping`);
                }
            } catch (collectionError) {
                console.error(`   ❌ Failed to migrate ${collectionName}:`, collectionError.message);
                failedCollections.push(collectionName);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log(`✨ Migration completed!`);
        console.log(`📊 Total documents migrated: ${totalMigrated}`);
        if (failedCollections.length > 0) {
            console.log(`⚠️  Failed collections: ${failedCollections.join(', ')}`);
        }
        console.log('='.repeat(60));

        console.log('\n📊 Atlas collections after migration:');
        const atlasCollections = await atlasDb.listCollections().toArray();
        for (const collection of atlasCollections) {
            const count = await atlasDb.collection(collection.name).countDocuments();
            console.log(`   - ${collection.name}: ${count} documents`);
        }

    } catch (error) {
        console.error('\n❌ Migration failed!');
        console.error('Error:', error.message);
    } finally {
        await localClient.close();
        await atlasClient.close();
        console.log('\n🔌 Connections closed.');
    }
}

migrate().catch(console.error);